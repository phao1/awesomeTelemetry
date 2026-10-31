import { useRef, useState, useEffect, type ReactNode } from 'react';
import { IconSearch, IconPanelLeft } from './icons/index.js';
import type { Locale } from '../i18n.js';
export function PageHeader({title,description,breadcrumb,actions,onSearch,onMenu,locale='zh'}:{title:string;description?:string;breadcrumb?:ReactNode;actions?:ReactNode;onSearch?:()=>void;onMenu?:()=>void;locale?:Locale}):React.JSX.Element {
 const ref=useRef<HTMLElement>(null),[scrolled,setScrolled]=useState(false);
 useEffect(()=>{const parent=ref.current?.parentElement;const update=()=>setScrolled((parent?.scrollTop??0)>0);parent?.addEventListener('scroll',update);return ()=>parent?.removeEventListener('scroll',update);},[]);
 return <header ref={ref} className={`page-header ${scrolled?'is-scrolled':''}`}><button className="ui-icon-btn mobile-menu" type="button" aria-label={locale==='zh'?'打开导航':'Open navigation'} onClick={onMenu}><IconPanelLeft/></button><div className="page-heading">{breadcrumb&&<div className="page-breadcrumb">{breadcrumb}</div>}<h1 title={title}>{title}</h1>{description&&<p>{description}</p>}</div><div className="page-actions">{onSearch&&<button type="button" className="page-search" aria-label={locale==='zh'?'全局搜索':'Global search'} onClick={onSearch}><IconSearch/><span>{locale==='zh'?'搜索…':'Search…'}</span><kbd>⌘K</kbd></button>}{actions}</div></header>;
}
