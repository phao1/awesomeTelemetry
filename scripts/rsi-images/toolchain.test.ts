import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
describe('RSI-013 bundled toolchain pins', () => {
  it.each(['rsi-agents/opencode/target.Dockerfile', 'rsi-agents/mini-agent/target.Dockerfile', 'scripts/rsi-images/evaluator.Dockerfile'])('%s uses Go 1.23 and offline settings', async file => {
    const text = await readFile(file, 'utf8');
    expect(text).toContain('COPY --from=golang:1.23-bookworm /usr/local/go /usr/local/go');
    expect(text).toContain('ENV PATH="/usr/local/go/bin:${PATH}"');
    expect(text).toContain('GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off');
    expect(text).not.toMatch(/apt-get install[^\n]*(?:golang|golang-go)/);
    if (file.includes('target')) {
      const sourceLayer = text.slice(text.indexOf('COPY source/'));
      const compilation = sourceLayer.slice(0, sourceLayer.indexOf('\nFROM '));
      for (const line of compilation.split('\n').filter(s => s.startsWith('RUN '))) expect(line).toMatch(/^RUN --network=none /);
    }
  });
});
