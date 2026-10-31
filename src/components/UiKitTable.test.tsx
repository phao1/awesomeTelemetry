import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect} from 'vitest';
import {UiKitTable} from './UiKitTable.js';
it('exhibits selection, bulk actions, expansion, menu, row activation, paging, loading and empty states',()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  act(()=>root.render(<UiKitTable locale="en"/>));expect(host.textContent).toContain('Demonstration data');
  const rows=()=>host.querySelectorAll<HTMLTableRowElement>('tr[data-table-row]');expect(rows()).toHaveLength(5);expect(host.querySelector('.ui-sticky-cell')).not.toBeNull();expect(host.querySelector('tr[data-tone=danger]')).not.toBeNull();
  act(()=>rows()[0]!.querySelector<HTMLInputElement>('input')!.click());expect(host.querySelector<HTMLInputElement>('thead input')!.indeterminate).toBe(true);expect(host.querySelector('[aria-label="Bulk actions"]')).not.toBeNull();
  act(()=>rows()[0]!.querySelector<HTMLButtonElement>('[aria-expanded]')!.click());expect(host.querySelector('.ui-subrow')!.textContent).toContain('Request');
  act(()=>rows()[0]!.querySelector<HTMLButtonElement>('.ui-row-actions button')!.click());expect(document.querySelector('[role=menu]')).not.toBeNull();act(()=>document.querySelector<HTMLButtonElement>('[role=menuitem]')!.click());expect(document.querySelector('.ui-modal')).not.toBeNull();act(()=>document.querySelector<HTMLButtonElement>('.ui-modal .ui-icon-btn')!.click());
  act(()=>host.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click());expect(host.textContent).toContain('6–10 / 12');
  const check=(name:string)=>[...host.querySelectorAll<HTMLLabelElement>('label')].find(el=>el.textContent===name)!.querySelector('input')!;
  act(()=>check('Loading / 加载').click());expect(host.querySelectorAll('.ui-table-skeleton-row')).toHaveLength(6);act(()=>check('Loading / 加载').click());act(()=>check('Empty / 空态').click());expect(host.textContent).toContain('No tasks yet');
 }finally{act(()=>root.unmount());host.remove();}
});
