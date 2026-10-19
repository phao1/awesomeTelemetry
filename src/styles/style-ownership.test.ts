import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

describe('feature-owned stylesheet loading', () => {
  it('retains inline Team body/focus rules and replaces the timeline skeleton with owned stage playback', () => {
    const source = read('src/components/team/TeamShell.tsx');
    const css = read('src/styles/components/team.css');
    for (const name of ['team-inspector-body-content', 'team-topo-node']) {
      expect(source).toContain(name);
      expect(css).toContain(`.${name}`);
    }
    expect(css).toMatch(/\.team-topo-node:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring\)/);
    expect(source).toContain('<StageReplay snapshot={snapshot} activities={activities}');
    const replay = read('src/components/agent-collab/StageReplay.tsx');
    expect(replay).toContain("import '../../styles/components/stage-replay.css'");
    const replayCss = read('src/styles/components/stage-replay.css');
    expect(replayCss).toMatch(/\.sr-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 2fr\)/);
    expect(replayCss).toMatch(/\.sr-evidence pre\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
  it('keeps wide collaboration graphs at intrinsic size inside their horizontal scroll region', () => {
    const css = read('src/styles/components/agent-collab.css');
    expect(css).toMatch(/\.collab-topology-wrap\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.collab-topology-graph\s*\{[^}]*max-width:\s*none/);
    expect(css).not.toMatch(/\.collab-topology-graph\s*\{[^}]*max-width:\s*100%/);
  });
  it('loads session collaboration replay styles from its own entry, without visiting the lazy Team view', () => {
    expect(read('src/components/AgentCollabReplay.tsx')).toContain("import '../styles/components/agent-collab.css'");
    const css = read('src/styles/components/agent-collab.css');
    expect(css).toContain('.session-collab-replay-panel');
    expect(css).toContain('.collab-replay-controls');
    expect(css).toContain('.collab-activity-panel');
    expect(css).toContain('.collab-activity-group');
    expect(read('src/styles/components/team.css')).not.toContain('.session-collab-replay-panel');
  });

  it.each(['TopologyView', 'TaskDagView', 'TeamTimeline', 'CommunicationView', 'EntityInspector'])('%s carries its visual styles independently', name => {
    const source = read(`src/components/team/${name}.tsx`);
    expect(source).toContain("import '../../styles/components/team.css'");
    expect(source).toContain("import '../../styles/components/team-views.css'");
  });

  it('keeps the Team comparison policy free of component/stylesheet side effects', () => {
    expect(read('src/components/team/TeamShell.tsx')).toContain("from './token-only-comparison.js'");
    expect(read('src/components/team/TeamCompareView.tsx')).toContain("from './token-only-comparison.js'");
    expect(read('src/components/team/TeamCompareView.tsx')).toContain("import '../../styles/components/team-compare.css'");
    expect(read('src/components/team/token-only-comparison.ts')).not.toMatch(/import\s+['"].*\.css/);
  });

  it('preserves the global reset/token layering and reduced-motion hard override', () => {
    const source = read('src/main.tsx');
    const imports = [...source.matchAll(/import ['"]\.\/styles\/([^'"]+\.css)['"]/g)].map(match => match[1]);
    expect(imports).toEqual(['tokens.css', 'base.css', 'layout.css', 'components.css']);
    expect(read('src/styles/base.css')).toContain('animation-duration: 0ms !important');
    expect(read('src/styles/base.css')).toContain('transition-duration: 0ms !important');
    expect(read('src/styles/components/team.css')).toContain('height: var(--row-lg)');
  });
});
