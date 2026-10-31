import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Disclosure, FilePicker, OptionSelect } from './PageControls.js';
import { Dropzone } from './Dropzone.js';
import { chooseOption } from './test-controls.js';
const cleanups:Array<()=>void>=[];
function mount(node:React.ReactNode){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);act(()=>root.render(node));cleanups.push(()=>{act(()=>root.unmount());host.remove();});return host;}
afterEach(()=>{cleanups.splice(0).forEach(cleanup=>cleanup());vi.restoreAllMocks();});
it('uses labelled library options and activates the real popup by keyboard',()=>{
 const change=vi.fn();const host=mount(<label>Repetitions<OptionSelect value="3" onChange={change}>{[1,3,5].map(n=><option key={n} value={n}>{n}</option>)}</OptionSelect></label>);
 expect(host.querySelector('select')).toBeNull();const trigger=host.querySelector<HTMLButtonElement>('[role=combobox]')!;expect(trigger.getAttribute('aria-label')).toBe('Repetitions');
 act(()=>trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})));
 act(()=>trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true})));
 act(()=>trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
 expect(change.mock.calls[0]![0].target.value).toBe('5');expect(trigger.getAttribute('aria-expanded')).toBe('false');
});
it('discloses an already mounted form without a native details marker',()=>{
 const host=mount(<Disclosure title="Advanced"><input defaultValue="retained draft"/></Disclosure>);const trigger=host.querySelector<HTMLButtonElement>('button')!;
 expect(host.querySelector('details')).toBeNull();expect(host.querySelector('[hidden]')).not.toBeNull();act(()=>trigger.click());expect(trigger.getAttribute('aria-expanded')).toBe('true');act(()=>trigger.click());expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('retained draft');
});
it('keeps file inputs hidden and forwards explicit browser selection',()=>{
 const changed=vi.fn(),host=mount(<FilePicker aria-label="Import report" accept=".json" onChange={changed}/>);const input=host.querySelector<HTMLInputElement>('input')!;expect(input.hidden).toBe(true);const click=vi.spyOn(input,'click');act(()=>host.querySelector<HTMLButtonElement>('button')!.click());expect(click).toHaveBeenCalledOnce();act(()=>input.dispatchEvent(new Event('change',{bubbles:true})));expect(changed).toHaveBeenCalledOnce();
});
it('accepts dropped files and blocks dropping when disabled',()=>{
 const onFile=vi.fn(),file=new File(['{}'],'report.json');const host=mount(<Dropzone label="Drop report" accept=".json" onFile={onFile}/>);const drop=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:{files:[file]}});act(()=>host.querySelector('.ui-dropzone')!.dispatchEvent(drop));expect(onFile).toHaveBeenCalledWith(file);
 const disabled=mount(<Dropzone label="Disabled" accept=".json" disabled onFile={onFile}/>);act(()=>disabled.querySelector('.ui-dropzone')!.dispatchEvent(drop));expect(onFile).toHaveBeenCalledTimes(1);
});
it('chooses dynamic options without serializing or executing their content',()=>{
 const onChange=vi.fn(),host=mount(<OptionSelect aria-label="Task" value="" onChange={onChange}><option value="">Choose</option><option value="retained">{'<script>inert</script>'}</option></OptionSelect>);chooseOption(host.querySelector('[role=combobox]')!,'retained');expect(onChange.mock.calls[0]![0].target.value).toBe('retained');expect(document.querySelector('script')).toBeNull();
});
