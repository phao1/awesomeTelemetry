import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventDetailCache } from '../../cache/caches.js';
import { installKeyboardShortcuts } from '../../keyboard.js';
import { LAYOUT_KEYS } from '../../layout.js';
import { makeSession } from '../compare-test-fixtures.js';
import { MessageCard } from './MessageCard.js';
import { RecordInspector } from './RecordInspector.js';
import { makeEvent, makeMessage } from './investigation-test-fixtures.js';
import type { TraceEvent } from '../../core/trace-types.js';

const mounted: Array<{root: ReturnType<typeof createRoot>; host: HTMLDivElement}> = [];
const originalWidth = localStorage.getItem(LAYOUT_KEYS.inspectorWidth);
afterEach(() => {
  act(() => { for (const {root,host} of mounted.splice(0)) { root.unmount(); host.remove(); } });
  eventDetailCache.clear();
  if (originalWidth === null) localStorage.removeItem(LAYOUT_KEYS.inspectorWidth);
  else localStorage.setItem(LAYOUT_KEYS.inspectorWidth, originalWidth);
});
function mount(node: React.JSX.Element) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host); mounted.push({root,host}); act(() => root.render(node));
  return {host, render: (next: React.JSX.Element) => act(() => root.render(next))};
}

describe('WB-002 selected record inspector', () => {
  it('loads only the selected body and keeps original bytes behind an explicit Raw action', async () => {
    const message = makeMessage(); const load = vi.fn(async () => makeEvent(message));
    const rawText = '<script>not executed</script>\n{"exact":true}';
    const raw = vi.fn(async () => ({...makeEvent(message),raw:rawText}));
    const {host} = mount(<RecordInspector sessionKey="s" session={makeSession('s')} message={message} locale="zh" onClose={() => undefined} loadDetail={load} loadRaw={raw} />);
    await act(async () => { await Promise.resolve(); });
    expect(load).toHaveBeenCalledExactlyOnceWith('s','e1'); expect(raw).not.toHaveBeenCalled();
    expect(host.textContent).toContain('SYNTHETIC_READ_RESULT');
    expect(host.textContent).toContain('2026-10-17T00:00:00.000Z');
    const rawButton = Array.from(host.querySelectorAll('button')).find(button=>button.textContent === 'Raw')!;
    await act(async () => {rawButton.click();await Promise.resolve();});
    expect(raw).toHaveBeenCalledExactlyOnceWith('s','e1');
    expect(host.querySelector('.message-card-body pre')?.textContent).toBe(rawText);
    expect(host.querySelector('script')).toBeNull();
  });
  it('shares a real in-flight load with the simultaneously expanded inline card', async () => {
    const message = makeMessage(); let finish!: (value: TraceEvent) => void;
    const load = vi.fn(() => new Promise<TraceEvent>(resolve=>{finish=resolve;}));
    const {host} = mount(<>
      <MessageCard sessionKey="s" message={message} locale="zh" initialExpanded loadDetail={load} />
      <RecordInspector sessionKey="s" session={makeSession('s')} message={message} locale="zh" onClose={() => undefined} loadDetail={load} />
    </>);
    await act(async () => {await Promise.resolve();}); expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {finish(makeEvent(message));});
    expect(host.querySelectorAll('.message-card')).toHaveLength(2);
    expect(host.textContent?.match(/SYNTHETIC_READ_RESULT/g)).toHaveLength(2);
  });
  it('refreshes only the selected snapshot without replaying Agent traffic or fetching Raw implicitly', async () => {
    const message=makeMessage(); const load=vi.fn().mockResolvedValueOnce(makeEvent(message,'OLD_SNAPSHOT')).mockResolvedValueOnce(makeEvent(message,'NEW_SNAPSHOT'));
    const raw=vi.fn(async()=>({...makeEvent(message),raw:'RAW'}));
    const {host}=mount(<RecordInspector sessionKey="s" session={makeSession('s')} message={message} locale="zh" onClose={()=>undefined} loadDetail={load} loadRaw={raw} />);
    await act(async()=>{await Promise.resolve();}); expect(host.textContent).toContain('OLD_SNAPSHOT');
    await act(async()=>{Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='刷新此记录')!.click();await Promise.resolve();});
    expect(load.mock.calls).toEqual([['s','e1'],['s','e1']]); expect(raw).not.toHaveBeenCalled();
    expect(host.textContent).toContain('NEW_SNAPSHOT'); expect(host.textContent).not.toContain('OLD_SNAPSHOT');
  });
  it('does not fetch absent bodies and preserves metadata without pretending a tool executed', async () => {
    const message = makeMessage('meta',1,{role:'system',kind:'message',hasInput:false,hasOutput:false,hasRaw:false,title:'Metadata only'});
    const load = vi.fn(async () => makeEvent(message));
    const {host} = mount(<RecordInspector sessionKey="s" session={makeSession('s')} message={message} locale="en" onClose={() => undefined} loadDetail={load} />);
    await act(async () => {await Promise.resolve();}); expect(load).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Metadata only'); expect(host.textContent).toContain('not measured model latency');
  });
  it('can inspect retained Raw for a compact event without changing collapsed inline compact rows', async () => {
    const message = makeMessage('compact',1,{role:'compact',kind:'message',hasInput:false,hasOutput:false,hasRaw:true});
    const load = vi.fn(async()=>makeEvent(message)); const raw = vi.fn(async()=>({...makeEvent(message),raw:'COMPACTION_ORIGINAL'}));
    const {host}=mount(<RecordInspector sessionKey="s" session={makeSession('s')} message={message} locale="en" onClose={()=>undefined} loadDetail={load} loadRaw={raw} />);
    const rawButton = Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Raw')!;
    expect(rawButton).toBeDefined();
    await act(async()=>{rawButton.click();await Promise.resolve();});
    expect(load).not.toHaveBeenCalled(); expect(raw).toHaveBeenCalledExactlyOnceWith('s','compact');
    expect(host.textContent).toContain('COMPACTION_ORIGINAL');
  });
  it('keeps a late previous-record response out of the newly selected record', async () => {
    let finish!: (value: TraceEvent) => void;
    const first = makeMessage('old'); const second = makeMessage('current',2);
    const load = vi.fn((_session: string,id: string) => id==='old'
      ? new Promise<TraceEvent>(resolve=>{finish=resolve;}) : Promise.resolve(makeEvent(second,'CURRENT_EVIDENCE')));
    const props = {sessionKey:'s',session:makeSession('s'),locale:'en' as const,onClose:()=>undefined,loadDetail:load};
    const view = mount(<RecordInspector {...props} message={first} />);
    await act(async () => {await Promise.resolve();});
    view.render(<RecordInspector {...props} message={second} />);
    await act(async () => {await Promise.resolve();});
    await act(async () => {finish(makeEvent(first,'STALE_EVIDENCE'));});
    expect(view.host.textContent).toContain('CURRENT_EVIDENCE'); expect(view.host.textContent).not.toContain('STALE_EVIDENCE');
  });
  it('resizes by keyboard, closes on Escape, and returns focus to the originating control', () => {
    installKeyboardShortcuts();
    function Harness() {
      const [open,setOpen] = useState(false);
      return <><button onClick={()=>setOpen(true)}>Inspect selected</button>{open && <RecordInspector sessionKey="s" session={makeSession('s')}
        message={makeMessage('meta',1,{hasInput:false,hasOutput:false,hasRaw:false})} locale="en" onClose={()=>setOpen(false)} />}</>;
    }
    const {host}=mount(<Harness />); const trigger=host.querySelector('button')!;
    act(()=>{trigger.focus();trigger.click();});
    const handle=host.querySelector('[role="separator"]') as HTMLElement;
    const before=Number(handle.getAttribute('aria-valuenow'));
    act(()=>handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true})));
    expect(Number(handle.getAttribute('aria-valuenow'))).toBe(before+16);
    expect(localStorage.getItem(LAYOUT_KEYS.inspectorWidth)).toBe(String(before+16));
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
    expect(host.querySelector('.record-inspector')).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
});
