import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { HealthReportExport } from './HealthReportExport.js';
it('exports all three retained formats from one keyboard-accessible menu',()=>{
 const host=document.createElement('div'),root=createRoot(host);document.body.append(host);const urls:string[]=[];vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){urls.push(this.getAttribute('href')!);});
 try{act(()=>root.render(<HealthReportExport id="saved" locale="zh"/>));expect(host.querySelectorAll('button')).toHaveLength(1);expect(host.querySelectorAll('a')).toHaveLength(0);for(const label of ['HTML','Markdown','JSON']){act(()=>host.querySelector('button')!.click());act(()=>[...document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(b=>b.textContent===label)!.click());}expect(urls).toEqual(['html','md','json'].map(format=>`/api/health-reports/saved/export?format=${format}`));}finally{act(()=>root.unmount());host.remove();vi.restoreAllMocks();}
});
