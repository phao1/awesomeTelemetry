import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { extractFiles } from './artifacts.js';
import type { DockerClient } from './docker.js';
import { isolationArgs, mustDocker, RSI_LABEL } from './docker.js';

export interface MockScript { outcome: 'pass' | 'fail' | 'flaky'; passCommand: string; failCommand?: string; repetitions?: boolean[] }
export interface ProxySettings {
  mode: 'mock' | 'real'; maxTokens: number; inputTokensPerByte: number;
  mockTable: Record<string, MockScript>;
}
export interface UsageReceipt { runId: string; tokens: number; requests: number; blocked: boolean; complete: boolean }
export interface ProxyRun { name: string; network: string; token: string; runId: string }
export function upstreamEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  const keys = ['RSI_UPSTREAM_BASE_URL', 'RSI_UPSTREAM_MODEL', 'RSI_UPSTREAM_API_KEY'];
  const missing = keys.filter(k => !env[k]?.trim());
  if (missing.length) throw new Error(`Missing upstream environment: ${missing.join(', ')}`);
  for (const key of keys) result[key] = env[key];
  return result;
}
export async function exportProxyArtifacts(client: DockerClient, proxy: ProxyRun, output: string): Promise<void> {
  const archive = await mustDocker(client, ['exec', proxy.name, 'tar', '-cf', '-', '-C', '/out', '.'], { maxOutputBytes: 64 * 1024 * 1024 });
  await extractFiles(archive, join(output, 'proxy'));
}
export async function startProxy(client: DockerClient, taskId: string, runId: string, questionId: string, repetition: number,
  budget: number, settings: ProxySettings, signal?: AbortSignal, sidecar?: { apiBase: string; domains: string[]; redactionHashes?: string[] }): Promise<ProxyRun> {
  const upstream = settings.mode === 'real' ? upstreamEnvironment() : {};
  const name = `rsi-proxy-${randomUUID()}`, network = `rsi-net-${randomUUID()}`, token = randomBytes(32).toString('hex');
  await mustDocker(client, ['network', 'create', '--internal', '--label', `${RSI_LABEL}=${taskId}`, network], { signal });
  try {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, DOCKER_CONFIG: process.env.DOCKER_CONFIG,
      RSI_RUNS: JSON.stringify([{ token, runId, questionId, repetition, budget }]), RSI_MODEL: settings.mode,
      RSI_MAX_TOKENS: String(settings.maxTokens), RSI_INPUT_TOKENS_PER_BYTE: String(settings.inputTokensPerByte),
      RSI_MOCK_TABLE: JSON.stringify(settings.mockTable) };
    const keys = ['RSI_RUNS', 'RSI_MODEL', 'RSI_MAX_TOKENS', 'RSI_INPUT_TOKENS_PER_BYTE', 'RSI_MOCK_TABLE'];
    if (sidecar) {
      const url = new URL(sidecar.apiBase);
      if (url.protocol !== 'http:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('Invalid platform origin');
      if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) url.hostname = 'host.lima.internal';
      env.RSI_REDACTION_HASHES=JSON.stringify(sidecar.redactionHashes??[]);keys.push('RSI_REDACTION_HASHES');
      env.RSI_AGENT_UPSTREAM = url.origin; env.RSI_EGRESS_DOMAINS = JSON.stringify(sidecar.domains); keys.push('RSI_AGENT_UPSTREAM', 'RSI_EGRESS_DOMAINS');
    }
    if (settings.mode === 'real') for (const key of ['RSI_UPSTREAM_BASE_URL', 'RSI_UPSTREAM_API_KEY', 'RSI_UPSTREAM_MODEL']) {
      env[key] = upstream[key]; keys.push(key);
    }
    await mustDocker(client, ['create', ...isolationArgs(network, taskId, name, '256m'), '--label', `rsi.run=${runId}`,
      '--network-alias', 'rsi-proxy', ...keys.flatMap(k => ['-e', k]), 'rsi-proxy:p2'], { env, signal });
    await mustDocker(client, ['network', 'connect', 'bridge', name], { signal });
    await mustDocker(client, ['start', name], { signal });
    await mustDocker(client, ['exec', name, 'node', '-e',
      "let n=0;const t=setInterval(async()=>{try{const r=await fetch('http://127.0.0.1:8080/health');if(r.ok){clearInterval(t);process.exit(0)}}catch{}if(++n>=50)process.exit(125)},100)"], { signal, timeoutMs: 10_000 });
    return { name, network, token, runId };
  } catch (error) {
    try { await mustDocker(client, ['rm', '-f', name]); }
    finally { await mustDocker(client, ['network', 'rm', network]); }
    throw error;
  }
}

export async function readProxyUsage(client: DockerClient, name: string, runId: string, includePending = false): Promise<UsageReceipt> {
  const output = await mustDocker(client, ['exec', name, 'node', '-e',
    "const f=require('fs'),r=require('readline');(async()=>{let tokens=0,requests=0,blocked=false,complete=true;const entries=new Map();if(f.existsSync('/out/usage.jsonl'))for await(const line of r.createInterface({input:f.createReadStream('/out/usage.jsonl')})){const e=JSON.parse(line);if(e.runId!==process.argv[1]||typeof e.requestId!=='string')throw Error('run mismatch');entries.set(e.requestId,e)}for(const e of entries.values()){if(e.stage==='reserved'&&process.argv[2]!=='true')continue;tokens+=e.chargedTokens;requests++;blocked||=e.status===429;complete&&=e.stage==='settled'&&(e.status===429||!!e.complete&&!!e.usage&&!e.error)}console.log(JSON.stringify({runId:process.argv[1],tokens,requests,blocked,complete}))})().catch(()=>process.exit(125))", runId, String(includePending)]);
  const value = JSON.parse(output.toString()) as UsageReceipt;
  if (value.runId !== runId || !Number.isSafeInteger(value.tokens) || value.tokens < 0 || !Number.isSafeInteger(value.requests)
    || value.requests < 0 || typeof value.blocked !== 'boolean' || typeof value.complete !== 'boolean') throw new Error('Invalid proxy usage');
  return value;
}
export async function stopProxy(client: DockerClient, proxy: ProxyRun): Promise<void> {
  try { await mustDocker(client, ['rm', '-f', proxy.name]); }
  finally { await mustDocker(client, ['network', 'rm', proxy.network]); }
}
