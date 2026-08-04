import { describe, expect, it } from 'vitest';

import { claudeFixture } from './__fixtures__/claude.js';
import { opencodeFixture } from './__fixtures__/opencode.js';
import { traeFixture } from './__fixtures__/trae.js';
import { normalizeRawSample } from './sample-loader.js';

describe('REQ-001/011 sample-loader 分发', () => {
  it('按 sourceAgent 分发到对应 adapter', () => {
    const claude = normalizeRawSample(claudeFixture, '/tmp/claude.jsonl');
    expect(claude.session.provider).toBe('claude');
    expect(claude.session.sourceAgent).toBe('Claude');

    const opencode = normalizeRawSample(
      { sourceAgent: 'OpenCode', session: opencodeFixture.session, events: opencodeFixture.events },
      '/tmp/oc.sqlite',
    );
    expect(opencode.session.provider).toBe('opencode');
    expect(opencode.session.isSubagent).toBe(true);

    const trae = normalizeRawSample(
      { sourceAgent: 'Trae', session: traeFixture.session, events: traeFixture.events },
      '/tmp/trae.db',
    );
    expect(trae.session.provider).toBe('trae');
  });

  it('未知 sourceAgent 抛错', () => {
    expect(() =>
      normalizeRawSample({ sourceAgent: 'Nope', session: {}, events: [] }, '/tmp/x'),
    ).toThrow(/未知 sourceAgent/);
  });
});
