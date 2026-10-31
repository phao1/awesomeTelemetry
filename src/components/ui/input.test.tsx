import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { SearchInput } from './Input.js';

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

describe('REQ-005 SearchInput', () => {
  it('清除按钮清空并保持焦点', () => {
    const container = render(<SearchInput defaultValue="abc" />);
    const input = container.querySelector('input') as HTMLInputElement;
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    });
    // D1：SearchInput 自身不再挂 / 监听（全局快捷键管理器负责聚焦）
    expect(document.activeElement).not.toBe(input);
    act(() => input.focus());
    const clear = container.querySelector('.ui-input-clear button') as HTMLButtonElement;
    expect(clear).not.toBeNull();
    act(() => clear.click());
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
  });
});

it.each([
 ['task-workbench','task-record-filters'],['agent-folding-workbench','architecture-toolbar'],
 ['team-exp-center','team-exp-record-filters'],['benchmark-setup','benchmark-heading'],
 ['experiment-records','experiment-form'],['team-workbench','tw-toolbar'],
 ['architecture-real-entry','architecture-threshold-grid'],['tool-filters','trace-export-range'],
 ['stage-replay','linked-trace-export-range'],
])('preserves SearchInput icon padding under legacy %s controls', (outer,inner)=>{
 const files=['components/ui.css','components/foundation.css','task-workbench.css','task-process.css','task-reader.css','components/experiment-records.css','components/team-experiment.css','components/benchmark.css','components/agent-folding.css','components/team-workbench.css','components/linked-trace-export.css','components/trace-export.css','components/architecture-diagnosis.css','components/session.css','components/stage-replay.css'];
 const style=document.createElement('style');style.textContent=files.map(file=>readFileSync(process.cwd()+'/src/styles/'+file,'utf8')).join('\n');document.head.append(style);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{act(()=>root.render(<div className={outer}><div className={inner}><SearchInput placeholder="Search tasks or session IDs"/></div></div>));
 const input=host.querySelector('input')!;expect(getComputedStyle(input).paddingLeft).toBe('var(--space-8)');expect(getComputedStyle(input).paddingRight).toBe('var(--space-8)');
 // Every legacy padding selector must exclude the library input, regardless of stylesheet order.
 for(const file of files.slice(2)){const css=readFileSync(process.cwd()+'/src/styles/'+file,'utf8');for(const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){if(!/\bpadding(?:-left|-right)?\s*:/.test(match[2]!)||!match[1]!.includes('input'))continue;const selector=match[1]!.replace(/\/\*[\s\S]*?\*\//g,'').trim();expect(input.matches(selector),`${file}: ${selector}`).toBe(false);}}
 }finally{act(()=>root.unmount());host.remove();style.remove();}
});
