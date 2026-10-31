import { useState } from 'react';
import { Button } from '../../ui/Button.js';
import { DropdownMenu } from '../../ui/Overlay.js';
import { IconChevronDown } from '../../icons/index.js';
import type { Locale } from '../../../i18n.js';
import { healthApi } from './health-client.js';
/** Native downloads keep the existing retained-report export endpoints. */
export function HealthReportExport({id,locale}:{id:string;locale:Locale}) {
 const [open,setOpen]=useState(false);
 return <DropdownMenu open={open} onOpenChange={setOpen} trigger={props=><Button {...props} variant="secondary">{locale==='zh'?'导出':'Export'}<IconChevronDown/></Button>} items={(['html','md','json'] as const).map(format=>({id:format,label:format==='md'?'Markdown':format.toUpperCase(),onSelect:()=>{const link=document.createElement('a');link.href=healthApi.exportUrl(id,format);link.download='';link.click();}}))}/>;
}
