import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('workbench interaction style boundaries', () => {
  it('keeps connection recipe fields and commands contained, token-based and readable at narrow widths', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/components/workbench.css'), 'utf8');
    expect(css).toMatch(/\.monitor-fields\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toContain('.monitor-fields { grid-template-columns: minmax(0, 1fr); }');
    expect(css).toMatch(/\.monitor-command textarea\s*\{[^}]*width:\s*100%[^}]*resize:\s*vertical/);
    expect(css).toMatch(/\.monitor-setup label\s*\{[^}]*min-width:\s*0/);
  });
  it('contains capture metadata scrolling, fixed virtual rows and resizable readable body detail without layout motion', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/components/workbench.css'), 'utf8');
    expect(css).toMatch(/\.capture-workbench\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*auto/);
    expect(css).toMatch(/\.capture-request-scroll\s*\{[^}]*overflow:\s*auto[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.capture-request-table td\s*\{[^}]*height:\s*var\(--row-sm\)[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.capture-request-open\s*\{[^}]*height:\s*calc\(var\(--row-sm\) - 1px\)/);
    expect(css).toMatch(/\.capture-body-content\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*overflow:\s*auto[^}]*max-height:\s*60vh/);
    expect(css).toMatch(/\.capture-detail-resize\s*\{[^}]*cursor:\s*col-resize/);
  });
  it('keeps overview counts, card headers and source tables readable without page-wide overflow or virtual-row motion', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/components/agent-overview.css'), 'utf8');
    expect(css).toMatch(/\.overview-kpis\s*\{[^}]*minmax\(min\(100%/);
    expect(css).toMatch(/\.agent-table-region\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*auto/);
    expect(css).toMatch(/\.overview\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*auto/);
    expect(css).toMatch(/\.agent-table-region\s*\{[^}]*flex:\s*1[^}]*min-height:\s*calc\(var\(--space-10\) \* 4\)/);
    expect(css).toContain('.overview-table > :not(.agent-table-region) { flex-shrink: 0; }');
    expect(css).toMatch(/\.agent-card-head\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.agent-card-name\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.agent-card-metrics\s*\{[^}]*minmax\(min\(100%, calc\(var\(--space-10\) \* 4\)\)/);
    expect(css).not.toMatch(/\.agent-conclusion\b/);
  });
  it('contains TraceLog discovery and selected evidence without unbounded lists or layout motion', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/components/workbench.css'), 'utf8');
    expect(css).toMatch(/\.trace-import-drawer\s*\{[^}]*96vw/);
    expect(css).toMatch(/\.trace-import-layout\s*\{[^}]*minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.trace-import-session-list, \.trace-import-turn-list\s*\{[^}]*max-height:[^}]*overflow:\s*auto/);
    expect(css).toMatch(/\.trace-import-choice\s*\{[^}]*transition:\s*none/);
    expect(css).toMatch(/\.trace-import-body\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*overflow:\s*auto/);
    expect(css).toContain('.trace-import-layout { grid-template-columns: minmax(0, 1fr); }');
  });
  it('keeps administration paths and actions contained and scrollable',()=>{
    const css=readFileSync(join(process.cwd(),'src/styles/components/workbench.css'),'utf8');
    expect(css).toMatch(/\.admin-workbench\s*\{[^}]*overflow:\s*auto/);
    expect(css).toMatch(/\.settings-provider-path input\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.settings-actions\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toContain('.settings-provider-meta { grid-column: 1; }');
  });
  it('reserves a readable comparison-chart column while allowing narrow containers to shrink',()=>{
    const css=readFileSync(join(process.cwd(),'src/styles/components/compare.css'),'utf8');
    const grid=css.match(/\.compare-charts\s*\{([^}]+)\}/)?.[1];
    expect(grid).toContain('minmax(min(100%, calc(var(--chart-min) * 2)), 1fr)');
    expect(css).toMatch(/\.compare-chart\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.compare-section\s*\{[^}]*scroll-margin-top:\s*calc\(var\(--row-md\) \+ var\(--space-2\)\)/);
  });
  it('uses a separately scoped shared-chrome stylesheet', () => {
    expect(readFileSync(join(process.cwd(), 'src/styles/components.css'), 'utf8')).toContain("@import './components/workbench.css'");
  });
  it('does not add motion to virtual rows or animate layout dimensions', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/components/workbench.css'), 'utf8');
    expect(css).not.toMatch(/\.(?:rail-row|gantt-row|turn-row|proxy-table-row)\b/);
    expect(css).not.toMatch(/transition\s*:[^;]*(?:\ball\b|\bwidth\b|\bheight\b|\btop\b|\bleft\b)/);
    expect(css).toContain('var(--duration-base)');
    expect(readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8')).toContain('prefers-reduced-motion');
  });
  it('animates dialog entry using composited properties and token timing only', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/components/overlay.css'), 'utf8');
    expect(css).toContain('animation: workbench-dialog-in var(--duration-base) var(--ease-out)');
    const keyframes = css.slice(css.indexOf('@keyframes workbench-dialog-in'), css.indexOf('.ui-modal-sm'));
    expect(keyframes).toContain('opacity: 0'); expect(keyframes).toContain('translateY(var(--space-2))');
    expect(keyframes).not.toMatch(/\b(?:width|height|top|left)\s*:/);
    const base = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8');
    expect(base).toMatch(/prefers-reduced-motion: reduce/);
    expect(base).toContain('animation-duration: 0ms !important');
    expect(base).toContain('transition-duration: 0ms !important');
  });
  it('keeps session discovery reachable instead of inheriting the legacy hidden-rail fallback', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/components/workbench.css'), 'utf8');
    expect(css).toContain('.session-view-body > .rail { display: flex;');
    expect(css).toContain('.session-view-body { flex-direction: row; }');
  });
  it('keeps record-panel entry motion outside the virtual Turn rows', () => {
    const css=readFileSync(join(process.cwd(),'src/styles/components/trajectory.css'),'utf8');
    const panel=css.match(/\.record-inspector\s*\{([^}]+)\}/)?.[1];
    expect(panel).toContain('animation:');
    const frames=css.match(/@keyframes record-inspector-in\s*\{\s*from\s*\{([^}]*)\}\s*to\s*\{([^}]*)\}\s*\}/);
    expect(frames).not.toBeNull();
    const motion=`${frames?.[1]} ${frames?.[2]}`;
    expect(motion).toContain('opacity');
    expect(motion).toContain('translateX');
    expect(motion).not.toMatch(/\b(?:width|height|top|left)\s*:/);
    for(const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if(/\.(?:turn-row|turn-list|turn-card|message-card)\b/.test(rule[1]!)) expect(rule[2]).not.toMatch(/(?:transition|animation)\s*:/);
    }
  });
});
