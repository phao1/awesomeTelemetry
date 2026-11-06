import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { availability, BANK, filesUnder, options, readBank, ROOT, runTests, workspace } from './validate.mjs';

/** New-side line numbers, excluding context: mutation is confined to the reference fix. */
export function changedLines(patch) {
  const files = new Map();
  let path = null, line = 0;
  for (const text of patch.split('\n')) {
    if (text.startsWith('diff --git ')) { path = null; continue; }
    if (text.startsWith('+++ b/')) { path = text.slice(6); if (!files.has(path)) files.set(path, new Set()); continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (!path || !line || text.startsWith('---')) continue;
    if (text.startsWith('+')) { files.get(path).add(line); line++; }
    else if (text.startsWith(' ')) line++;
  }
  return files;
}

const operators = new Map([['===', '!=='], ['!==', '==='], ['==', '!='], ['!=', '=='], ['<=', '<'], ['>=', '>'], ['<', '<='], ['>', '>='], ['&&', '||'], ['||', '&&'], ['and', 'or'], ['or', 'and'], ['++', '--'], ['--', '++'], ['+', '-'], ['-', '+'], ['//', '/'], ['*', '/'], ['/', '*'], ['%', '/'], ['!', ''], ['not', '']]);
/** Literal tokens are consumed before operators, so fixture strings are never mutated. */
export function lineMutations(line) {
  const results = [];
  const tokens = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|===|!==|==|!=|<=|>=|&&|\|\||\+\+|--|\/\/|[<>!+*/%-]|\b(?:and|or|not)\b|\b\d+\b/g;
  for (const match of line.matchAll(tokens)) {
    const token = match[0];
    if (/^["'`]/.test(token)) continue;
    const replacements = operators.has(token) ? [operators.get(token)] : /^\d+$/.test(token) ? [String(Number(token) + 1), ...(Number(token) > 0 ? [String(Number(token) - 1)] : [])] : [];
    for (const replacement of replacements) results.push({ kind: `replace ${token} with ${replacement}`, text: line.slice(0, match.index) + replacement + line.slice(match.index + token.length) });
  }
  // Only whole statement-shaped lines. Invalid deletions (missing return/body/unused Go variable) are excluded after execution.
  if (/^\s*(?:return\b|(?:const|let|var)\s|(?:del|continue|break)\b|[\w.[\]"', ()]+(?:\s*=|\s*\+=|\s*-=)|[\w.]+\(.*\)\s*;?\s*$)/.test(line) && !/^\s*(?:import|from|export function|def|func|class|if|elif|else|for|while|switch|case|try|catch)\b/.test(line)) results.push({ kind: 'delete statement', text: '' });
  return results.filter(r => r.text !== line);
}
export function mutations(source, selected) {
  const lines = source.split('\n');
  const results = [], seen = new Set();
  for (const number of [...selected].sort((a, b) => a - b)) {
    for (const mutation of lineMutations(lines[number - 1] ?? '')) {
      const edited = [...lines]; edited[number - 1] = mutation.text;
      const text = edited.join('\n');
      if (!seen.has(text)) { seen.add(text); results.push({ line: number, kind: mutation.kind, source: text }); }
    }
  }
  return results;
}

export async function mutate({ bank = BANK, docker = false, log = console.log, document = join(ROOT, 'docs/rsi/bank.md') } = {}) {
  const { manifest, questions } = await readBank(bank);
  const result = { passed: [], skipped: [], failed: [], rows: [] };
  const available = {};
  for (const toolchain of ['node', 'python', 'go']) available[toolchain] = await availability(toolchain, docker);
  // Keep prior measured rows when a later local run cannot execute Go.
  const priorDoc = await readFile(document, 'utf8');
  for (const question of questions) {
    if (!available[question.meta.toolchain]) {
      result.skipped.push(question.id);
      const prior = priorDoc.split('<!-- mutation-results:start -->')[1]?.split('<!-- mutation-results:end -->')[0].split('\n').find(line => line.startsWith(`| ${question.id} |`) && line.split('|').length === 9);
      result.rows.push(prior ?? `| ${question.id} | pending | — | — | — | — | toolchain unavailable |`);
      log(`SKIP ${question.id}: ${docker ? 'docker' : question.meta.toolchain} toolchain unavailable; stored ratio=${question.mutationKillRatio}`); continue;
    }
    const space = await workspace(question, true);
    let killed = 0, survived = 0, invalid = 0, infrastructure = 0;
    const survivors = [];
    try {
      const healthy = await runTests(question, space, docker);
      if (!healthy.passed) throw new Error(`Reference failed before mutation: ${question.id}\n${healthy.output}`);
      const changes = changedLines(await readFile(join(question.directory, 'reference.patch'), 'utf8'));
      for (const [path, selected] of changes) {
        const target = join(space.work, path);
        const source = await readFile(target, 'utf8');
        for (const [index, mutation] of mutations(source, selected).entries()) {
          // Each mutant starts from the same source. Hidden tests are restored from trusted copies too.
          for (const hidden of await filesUnder(join(question.directory, 'hidden_tests'))) await writeFile(join(space.work, hidden), await readFile(join(question.directory, 'hidden_tests', hidden)));
          await writeFile(target, mutation.source);
          try {
            const outcome = await runTests(question, space, docker);
            if (outcome.timedOut && outcome.started && !outcome.spawnError && !outcome.overflow) { killed++; log(`KILL timeout ${question.id} ${path}:${mutation.line} ${mutation.kind}`); }
            else if (outcome.timedOut || outcome.spawnError || outcome.overflow) { infrastructure++; log(`INFRA ${question.id} ${path}:${mutation.line} ${mutation.kind}`); }
            else if (!outcome.complete) {
              // Missing tests may mean syntax/build failure, or import-time failure. Neither demonstrates test strength.
              invalid++;
            } else if (outcome.passed) { survived++; survivors.push(`${path}:${mutation.line}#${index + 1} ${mutation.kind}`); }
            else if (outcome.cases.some(test => !test.passed)) killed++;
            else infrastructure++;
          } finally { await writeFile(target, source); }
        }
      }
      if (infrastructure || killed + survived === 0) throw new Error(`Incomplete mutation evidence: ${infrastructure} infrastructure failures; ${killed + survived} valid mutants`);
      const ratio = killed / (killed + survived);
      manifest.questions.find(q => q.id === question.id).mutationKillRatio = ratio;
      result.rows.push(`| ${question.id} | ${docker ? 'docker' : 'local'} | ${killed} | ${survived} | ${invalid} | ${ratio.toFixed(4)} | ${survivors.join('; ') || 'none'} |`);
      log(`${ratio >= manifest.mutationKillMin ? 'PASS' : 'FAIL'} ${question.id}: killed=${killed} survived=${survived} invalid=${invalid} ratio=${ratio.toFixed(4)}`);
      if (ratio < manifest.mutationKillMin) result.failed.push(question.id); else result.passed.push(question.id);
    } catch (error) {
      result.failed.push(question.id);
      // Incomplete runs must not retain a previous passing ratio.
      manifest.questions.find(q => q.id === question.id).mutationKillRatio = 0;
      result.rows.push(`| ${question.id} | incomplete | ${killed} | ${survived} | ${invalid} | — | rerun required |`);
      log(`FAIL ${question.id}: ${error.message}`);
    } finally { await space.cleanup(); }
  }
  const text = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(join(bank, 'manifest.json'), text);
  const start = '<!-- mutation-results:start -->', end = '<!-- mutation-results:end -->';
  if (!priorDoc.includes(start) || !priorDoc.includes(end)) throw new Error('Missing documentation result markers');
  const table = '\n| Question | Mode | Killed | Survived | Invalid | Ratio | Surviving mutants / status |\n| --- | --- | ---: | ---: | ---: | ---: | --- |\n' + result.rows.join('\n') + '\n';
  await writeFile(document, priorDoc.slice(0, priorDoc.indexOf(start) + start.length) + table + priorDoc.slice(priorDoc.indexOf(end)));
  log(JSON.stringify({ mode: docker ? 'docker' : 'local', passed: result.passed, skipped: result.skipped, failed: result.failed }));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await mutate(options(process.argv.slice(2))); if (result.failed.length) process.exitCode = 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
