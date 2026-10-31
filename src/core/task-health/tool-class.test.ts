import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HealthInput } from './types.js';
import { classifyTool, commandProjection, normalizeCommand, normalizePath } from './tool-class.js';
const input = () => JSON.parse(readFileSync('src/core/__fixtures__/task-health/g1-serial.input.json', 'utf8')) as HealthInput;
it('classifies by command/tool metadata in priority order, never result prose', () => { const r = input().records[3]!; for (const [cmd, expected] of [['npm install', 'install'], ['pnpm ci', 'install'], ['pip install foo', 'install'], ['mvn dependency:resolve', 'install'], ['gradle --refresh-dependencies', 'install'], ['npm run lint', 'lint/typecheck'], ['npm test', 'test'], ['npm run build', 'build'], ['cat a.ts', 'read'], ['rg foo', 'search'], ['curl https://a', 'web'], ['echo test-result', 'shell']]) {
    r.native.command = cmd!;
    expect(classifyTool(r)).toBe(expected);
} r.native.command = null; r.event!.title = 'npm install'; expect(classifyTool(r)).toBe('shell'); r.native.delegateMemberId = 'child'; expect(classifyTool(r)).toBe('delegate'); });
it('normalizes literal cwd and command without expansion or changing quotes/case', () => { expect(commandProjection('cd web/../web && npm   install  "a  b"', '/repo/.')).toEqual({ cwd: '/repo/web', command: 'npm install "a  b"', cd: true, fingerprint: JSON.stringify(['/repo/web', 'npm install "a  b"']) }); expect(commandProjection('cd "$HOME" && npm install', '/repo').fingerprint).toBeNull(); expect(commandProjection('npm install', null).fingerprint).toBeNull(); expect(normalizeCommand('echo "A  B"   C')).toBe('echo "A  B" C'); expect(normalizePath('C:\\a\\..\\B')).toBe('C:/B'); });
