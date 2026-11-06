import { useState } from 'react';
import type { Locale } from '../../i18n.js';
import type { RsiFinding } from '../../core/rsi-types.js';
import { rsiApi } from '../../core/rsi-api-client.js';
import { DiffRowView, type DiffRow } from '../trajectory/renderers/edit.js';
import { Card, CardHeader, CardBody, Callout } from '../ui/Display.js';
import { Select } from '../ui/Select.js';
import { Button } from '../ui/Button.js';
import { PageSkeleton } from '../ui/PageSkeleton.js';
import { EmptyState } from '../ui/States.js';
import { IconFile } from '../icons/index.js';
import { useRsiRead } from './data.js';
import { copy } from './copy.js';
import { ReadError, Reason, Numeric } from './Shared.js';
interface FileDiff { file: string; rows: { row: DiffRow; line: number | null }[] }
export function parseDiff(diff:string):FileDiff[] {
  const files:FileDiff[]=[];let current:FileDiff|null=null,line=0;
  for(const text of diff.split('\n')) {
    if(text.startsWith('diff --git ')){current={file:text.split(' b/').at(-1)??text,rows:[]};files.push(current);line=0;continue;}
    if(!current)continue;
    if(text.startsWith('+++ ')){const path=text.slice(4);current.file=path.startsWith('b/')?path.slice(2):path.replace(/^"b\/(.*)"$/,'$1');continue;}
    if(text.startsWith('--- ')||text.startsWith('index '))continue;
    const hunk=/^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text);
    if(hunk){line=Number(hunk[1]);current.rows.push({row:{kind:'ctx',text},line:null});continue;}
    if(text.startsWith('+'))current.rows.push({row:{kind:'add',text:text.slice(1)},line:line++});
    else if(text.startsWith('-'))current.rows.push({row:{kind:'del',text:text.slice(1)},line:null});
    else if(text.startsWith(' '))current.rows.push({row:{kind:'ctx',text:text.slice(1)},line:line++});
    else if(text)current.rows.push({row:{kind:'ctx',text},line:null});
  }
  return files;
}
export function Diff({taskId,seq,findings,locale,file,onFile,revision}:{taskId:string;seq:number;findings:RsiFinding[];locale:Locale;file:string|null;onFile:(file:string)=>void;revision:number}) {
  const read=useRsiRead(`${taskId}:${seq}:diff`,signal=>rsiApi.diff(taskId,seq,signal),revision),[selected,setSelected]=useState<RsiFinding|null>(null),[limit,setLimit]=useState(200);
  if(read.loading&&!read.value)return <PageSkeleton compact/>;
  if(read.error)return <ReadError error={read.error} locale={locale} retry={read.retry}/>;
  const files=parseDiff(read.value?.diff??''),active=files.find(f=>f.file===file)??files[0];
  if(!active)return <EmptyState icon={<IconFile/>} title={copy(locale,'尚无平台改动记录','No platform diff available')}/>;
  const select=(file:string)=>{setLimit(200);setSelected(null);onFile(file);};
  return <Card><CardHeader title={copy(locale,'平台计算的改动','Platform-computed changes')} actions={<span className="rsi-inline"><Numeric value={read.value?.quality.files} locale={locale}/> {copy(locale,'个文件','files')} · <Numeric value={read.value?.quality.changedLines} locale={locale}/> {copy(locale,'行','lines')}</span>}/><CardBody>
    <div className="rsi-diff-mobile"><Select locale={locale} aria-label={copy(locale,'改动文件','Changed file')} value={active.file} options={files.map(f=>({value:f.file,label:f.file}))} onChange={e=>select(e.target.value)}/></div>
    <div className="rsi-diff-layout"><nav className="rsi-diff-files" aria-label={copy(locale,'文件','Files')}>{files.map(f=><Button variant={f.file===active.file?'secondary':'ghost'} title={f.file} key={f.file} onClick={()=>select(f.file)}><IconFile/>{f.file}</Button>)}</nav><div className="rsi-diff-code" aria-label={active.file}>{active.rows.slice(0,limit).map((entry,index)=>{
      const hits=(read.value?.findings??findings).filter(f=>f.file===active.file&&f.line===entry.line&&entry.line!==null&&(f.level==='L1'||f.level==='L4'));
      return <div key={index} className={`rsi-code-row ${hits.length?'is-flagged':''}`}><span className="rsi-code-line num">{entry.line??' '}</span><DiffRowView row={entry.row}/>{hits.length>0&&<Button variant="ghost" size="sm" onClick={()=>setSelected(hits[0]!)} aria-label={copy(locale,'查看此行发现','View line finding')}>ⓘ</Button>}</div>;
    })}{active.rows.length>limit&&<Button onClick={()=>setLimit(n=>n+200)}>{copy(locale,'继续显示改动','Show more changes')}</Button>}</div></div>
    {selected&&<Callout tone={selected.severity==='reject'?'danger':'attention'} title={copy(locale,'此行的发现','Finding on this line')}><Reason code={selected.category} locale={locale}/><pre className="rsi-evidence">{selected.evidence??'—'}</pre><Button variant="ghost" onClick={()=>setSelected(null)}>{copy(locale,'关闭','Close')}</Button></Callout>}
  </CardBody></Card>;
}
