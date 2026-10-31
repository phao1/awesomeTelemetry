import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { UiLocaleProvider } from './Locale.js';
import { CopyField } from './Display.js';
import { FilePicker } from './PageControls.js';
import { BarList } from '../charts/BarList.js';
it('updates common F5 labels immediately with the active language, including copy feedback',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn().mockResolvedValue(undefined)}});
 const render=(locale:'zh'|'en')=><UiLocaleProvider locale={locale}><CopyField label="Token" value="value" secret/><FilePicker/><BarList items={[]}/></UiLocaleProvider>;
 try{act(()=>root.render(render('en')));expect(host.textContent).toContain('Choose file');expect(host.textContent).toContain('No data');expect(host.querySelector('[aria-label=Show]')).not.toBeNull();expect(host.textContent).not.toMatch(/[\u4e00-\u9fff]/);await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label=Copy]')!.click());expect(document.body.textContent).toContain('Copied');act(()=>root.render(render('zh')));expect(host.textContent).toContain('选择文件');expect(host.textContent).toContain('暂无数据');expect(host.querySelector('[aria-label=显示]')).not.toBeNull();expect(host.querySelector('[aria-label=Copy]')).toBeNull();expect(document.body.textContent).toContain('已复制');}finally{act(()=>root.unmount());host.remove();}
});
