import { useState } from 'react';
import type { Locale } from '../i18n.js';
import { formatTokens } from '../core/format.js';
import { DataTable as Table, type TableColumn } from './ui/DataTable.js';
import { Card, CardHeader, Callout } from './ui/Display.js';
import { Checkbox } from './ui/Controls.js';
import { Badge, ProviderBadge } from './ui/Badge.js';
import { Button, IconButton } from './ui/Button.js';
import { DropdownMenu } from './ui/Overlay.js';
import { Dialog } from './ui/Modal.js';
import { EmptyState } from './ui/States.js';
import { IconMoreHorizontal, IconList } from './icons/index.js';
interface DemoRow { id: string; title: string; value: number; failed: boolean; }
const DEMO_ROWS: DemoRow[] = Array.from({ length: 12 }, (_, i) => ({ id: `demo-${i+1}`, title: ['Review implementation and validate the complete source evidence', 'Update settings and local data sources', 'Inspect task execution history'][i%3]!, value: 292700-i*12000, failed: i%3===1 }));
export function UiKitTable({ locale }: { locale: Locale }): React.JSX.Element {
  const zh=locale==='zh', [selected,setSelected]=useState<string[]>([]), [expanded,setExpanded]=useState<string[]>([]), [menu,setMenu]=useState<string|null>(null), [page,setPage]=useState(0), [size,setSize]=useState(5), [loading,setLoading]=useState(false), [empty,setEmpty]=useState(false), [opened,setOpened]=useState<DemoRow|null>(null), [action,setAction]=useState('');
  const columns:TableColumn<DemoRow>[]=[
    {key:'title',label:zh?'任务':'Task',width:'var(--dims-card-min)',render:r=>r.title},
    {key:'provider',label:zh?'工具':'Provider',render:()=> <ProviderBadge provider="codex" showLabel locale={locale}/>},
    {key:'status',label:zh?'状态':'Status',render:r=><Badge tone={r.failed?'danger':'success'}>{r.failed?'Failed / 失败':'Success / 成功'}</Badge>},
    {key:'token',label:'Token',align:'right',render:r=>formatTokens(r.value)},
    {key:'duration',label:zh?'时长':'Duration',align:'right',render:()=> '49.2s'},
    {key:'cache',label:zh?'缓存命中':'Cache hit',align:'right',render:()=> '87.4%'}
  ];
  return <Card><CardHeader title="3.4 DataTable / 表格" description="演示数据 · Demonstration data · ↑ ↓ Enter" actions={<div className="ui-kit-row"><Checkbox label="Loading / 加载" checked={loading} onChange={e=>setLoading(e.target.checked)}/><Checkbox label="Empty / 空态" checked={empty} onChange={e=>{setEmpty(e.target.checked);setPage(0);}}/></div>}/>
    {action&&<Callout title={action}/>}
    <Table label="Demo tasks / 演示任务" locale={locale} columns={columns} rows={empty?[]:DEMO_ROWS.slice(page*size,(page+1)*size)} rowKey={r=>r.id} loading={loading} stickyFirst selectedKeys={selected} onSelectionChange={setSelected} expandedKeys={expanded} onToggleExpand={key=>setExpanded(old=>old.includes(key)?old.filter(k=>k!==key):[...old,key])} expandLabel={r=>`${zh?'展开请求':'Expand requests'} ${r.id}`} renderSubrow={r=><span>1 · {r.title} · <Badge>Request / 请求</Badge> · 12.4K tokens</span>} onRowClick={setOpened} rowTone={r=>r.failed?'danger':r.id==='demo-3'?'attention':undefined}
      rowActions={r=><DropdownMenu open={menu===r.id} onOpenChange={open=>setMenu(open?r.id:null)} trigger={props=><IconButton {...props} label={`${zh?'任务操作':'Task actions'} ${r.id}`} icon={<IconMoreHorizontal/>}/>} items={[{id:'open',label:zh?'打开任务':'Open task',onSelect:()=>setOpened(r)},{id:'baseline',label:zh?'设为基线':'Set baseline',onSelect:()=>setAction(`${r.id} · ${zh?'已设为演示基线':'Demo baseline selected'}`)}]}/>}
      bulkActions={<><Button size="sm" onClick={()=>setAction(zh?'已设为演示基线':'Demo baseline selected')}>{zh?'设为基线':'Set baseline'}</Button><Button size="sm" onClick={()=>setAction(zh?'演示对比':'Demonstration comparison')}>{zh?'对比':'Compare'}</Button></>}
      pagination={{page,pageSize:size,total:empty?0:DEMO_ROWS.length,onPageChange:setPage,onPageSizeChange:setSize,pageSizes:[5,10,25]}}
      emptyState={<EmptyState icon={<IconList/>} title={zh?'还没有任务':'No tasks yet'} action={<Button onClick={()=>setEmpty(false)}>{zh?'显示演示数据':'Show demonstration data'}</Button>}/>}/>
    {opened&&<Dialog title={opened.title} onClose={()=>setOpened(null)}><Callout title="演示数据 / Demonstration data">{opened.id} · {formatTokens(opened.value)} tokens</Callout></Dialog>}
  </Card>;
}
