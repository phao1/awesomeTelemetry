import { useEffect, useState } from 'react';
const key='awesome-telemetry.sidebarCollapsed';
/** Only explicit actions persist; automatic breakpoint defaults remain responsive. */
export function useSidebarPreference():[boolean,()=>void]{
 const [preference,setPreference]=useState<boolean|null>(()=>{try{const saved=localStorage.getItem(key);return saved==='true'?true:saved==='false'?false:null;}catch(error){console.error('[sidebar] preference read failed',error);return null;}});
 const [compact,setCompact]=useState(()=>window.innerWidth<1280);
 useEffect(()=>{const media=window.matchMedia('(max-width: 1279px)');const resize=(event:MediaQueryListEvent)=>setCompact(event.matches);setCompact(media.matches);media.addEventListener('change',resize);return()=>media.removeEventListener('change',resize);},[]);
 const collapsed=preference??compact;
 return [collapsed,()=>{const next=!collapsed;setPreference(next);try{localStorage.setItem(key,String(next));}catch(error){console.error('[sidebar] preference write failed',error);}}];
}
