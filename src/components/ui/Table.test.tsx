import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Table } from './Table.js';

it('puts sort state on the column header and gives expansion its contextual row identity', () => {
  const container = document.createElement('div');document.body.appendChild(container);
  const root = createRoot(container);const expand = vi.fn();const sort = vi.fn();
  try {
    act(() => root.render(<Table columns={[{ key: 'name', label: 'Source', sortable: true, render: row => row.name }]} rows={[{ name: 'Specific source' }]}
      rowKey={row => row.name} sort={{ key: 'name', direction: 'desc' }} onSort={sort} expandedKey={null}
      onToggleExpand={expand} renderExpand={() => <tr><td>Details</td></tr>} expandLabel={row => 'Inspect ' + row.name} />));
    expect(container.querySelector('th[aria-sort="descending"]')?.textContent).toBe('Source');
    expect(container.querySelector('button[aria-sort]')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Inspect Specific source"]')!.click());
    expect(expand).toHaveBeenCalledWith('Specific source');
    act(() => container.querySelector<HTMLButtonElement>('thead button')!.click());expect(sort).toHaveBeenCalledWith('name');
  } finally { act(() => root.unmount());container.remove(); }
});

it('preserves off-page selection, provides mixed/full header states and bulk clearing',()=>{
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container),change=vi.fn();
 const props={columns:[{key:'name',label:'Task',render:(r:{id:string})=>r.id}],rows:[{id:'a'},{id:'b'}],rowKey:(r:{id:string})=>r.id,onSelectionChange:change,locale:'en' as const};
 try{
  act(()=>root.render(<Table {...props} selectedKeys={['outside','a']} bulkActions={<button>Compare</button>}/>));
  const header=container.querySelector<HTMLInputElement>('thead input')!;expect(header.indeterminate).toBe(true);expect(header.getAttribute('aria-checked')).toBe('mixed');
  act(()=>header.click());expect(change).toHaveBeenLastCalledWith(['outside','a','b']);
  act(()=>root.render(<Table {...props} selectedKeys={['outside','a','b']}/>));expect(header.checked).toBe(true);expect(header.indeterminate).toBe(false);
  act(()=>header.click());expect(change).toHaveBeenLastCalledWith(['outside']);
  expect(container.querySelector('[aria-label="Bulk actions"]')).not.toBeNull();
  act(()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Clear')!.click());expect(change).toHaveBeenLastCalledWith([]);
 }finally{act(()=>root.unmount());container.remove();}
});
it('separates row activation from checkbox, menu, expand and embedded controls',()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),open=vi.fn(),expand=vi.fn(),action=vi.fn();
 try{act(()=>root.render(<Table locale="en" columns={[{key:'name',label:'Task',render:(r:{id:string})=>r.id},{key:'link',label:'Link',render:()=> <a href="#example" onClick={e=>e.preventDefault()}>Evidence</a>}]} rows={[{id:'a'},{id:'b'}]} rowKey={r=>r.id} onRowClick={open} onSelectionChange={()=>undefined} onToggleExpand={expand} renderSubrow={r=>`Request ${r.id}`} rowActions={()=> <button onClick={action}>Actions</button>} rowTone={r=>r.id==='a'?'danger':'attention'} stickyFirst/>));
  const rows=host.querySelectorAll<HTMLTableRowElement>('tr[data-table-row]');expect(rows[0]!.dataset.tone).toBe('danger');expect(rows[1]!.dataset.tone).toBe('attention');
  act(()=>rows[0]!.click());expect(open).toHaveBeenCalledExactlyOnceWith({id:'a'});open.mockClear();
  act(()=>{rows[0]!.querySelector<HTMLInputElement>('input')!.click();rows[0]!.querySelector<HTMLButtonElement>('[aria-expanded]')!.click();rows[0]!.querySelector<HTMLButtonElement>('.ui-row-actions button')!.click();rows[0]!.querySelector('a')!.click();});expect(open).not.toHaveBeenCalled();expect(expand).toHaveBeenCalledWith('a');expect(action).toHaveBeenCalledOnce();
  act(()=>rows[0]!.focus());act(()=>rows[0]!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})));expect(document.activeElement).toBe(rows[1]);
  act(()=>rows[1]!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));expect(open).toHaveBeenCalledWith({id:'b'});
  act(()=>rows[1]!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true})));expect(document.activeElement).toBe(rows[0]);
  expect(rows[0]!.querySelectorAll('.ui-sticky-cell')).toHaveLength(3);expect(rows[0]!.querySelectorAll<HTMLElement>('.ui-sticky-cell')[2]!.style.left).toContain('* 2');expect(host.querySelector('.ui-table-wrap')!.getAttribute('role')).toBe('region');
 }finally{act(()=>root.unmount());host.remove();}
});
it('renders controlled child rows, skeleton loading and customizable empty state',()=>{
 const host=document.createElement('div'),root=createRoot(host);
 const props={columns:[{key:'name',label:'Task',render:(r:{id:string})=>r.id}],rowKey:(r:{id:string})=>r.id,rows:[{id:'a'}],onToggleExpand:()=>undefined,renderSubrow:()=> <button>Request 1</button>};
 try{act(()=>root.render(<Table {...props} expandedKeys={['a']}/>));expect(host.querySelector('.ui-subrow')!.textContent).toContain('Request 1');expect(host.querySelector('.ui-subrow td')!.getAttribute('colspan')).toBe('2');
  act(()=>root.render(<Table {...props} loading skeletonRows={4}/>));expect(host.querySelector('table')!.getAttribute('aria-busy')).toBe('true');expect(host.querySelectorAll('.ui-table-skeleton-row')).toHaveLength(4);expect(host.querySelector('tr[data-table-row]')).toBeNull();expect(host.querySelector('[role=status]')).not.toBeNull();
  act(()=>root.render(<Table {...props} rows={[]} locale="en"/>));expect(host.textContent).toContain('No data');
  act(()=>root.render(<Table {...props} rows={[]} emptyState={<button>Connect source</button>}/>));expect(host.textContent).toContain('Connect source');
 }finally{act(()=>root.unmount());}
});
it('offers zero-based controlled pagination with bounds and page-size selection',()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),page=vi.fn(),size=vi.fn();
 const props={columns:[{key:'name',label:'Task',render:(r:{id:string})=>r.id}],rows:[{id:'a'}],rowKey:(r:{id:string})=>r.id,locale:'en' as const};
 try{act(()=>root.render(<Table {...props} pagination={{page:0,pageSize:5,total:12,onPageChange:page,onPageSizeChange:size,pageSizes:[5,10]}}/>));
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Previous page"]')!.disabled).toBe(true);expect(host.textContent).toContain('1–5 / 12');
  act(()=>host.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click());expect(page).toHaveBeenLastCalledWith(1);
  act(()=>host.querySelector<HTMLButtonElement>('[role=combobox]')!.click());act(()=>document.querySelectorAll<HTMLButtonElement>('[role=option]')[1]!.click());expect(size).toHaveBeenCalledWith(10);expect(page).toHaveBeenLastCalledWith(0);
  act(()=>root.render(<Table {...props} pagination={{page:2,pageSize:5,total:12,onPageChange:page}}/>));expect(host.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.disabled).toBe(true);expect(host.textContent).toContain('11–12 / 12');
 }finally{act(()=>root.unmount());host.remove();}
});
it('renders externally expanded subrows without inserting an unused disclosure column',()=>{
 const host=document.createElement('div'),root=createRoot(host);
 try{act(()=>root.render(<Table rows={[{id:'a'}]} rowKey={r=>r.id} columns={[{key:'title',label:'Task',render:r=>r.id}]} expandedKeys={['a']} renderSubrow={()=> 'Request evidence'}/>));expect(host.querySelectorAll('thead th')).toHaveLength(1);expect(host.querySelector('.ui-subrow td')!.getAttribute('colspan')).toBe('1');expect(host.textContent).toContain('Request evidence');}finally{act(()=>root.unmount());}
});
