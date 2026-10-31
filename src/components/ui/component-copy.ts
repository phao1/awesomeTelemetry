import {useSyncExternalStore} from 'react';
import type { Locale } from '../../i18n.js';
export const componentCopy=(locale:Locale=(typeof document!=='undefined'&&document.documentElement.lang==='en'?'en':'zh'))=>locale==='zh'?{empty:'暂无数据',noResults:'无匹配项',more:'查看全部',less:'收起',loadMore:'加载更多',total:'总计',select:'请选择…',remove:'移除',search:'搜索',count:'数量',show:'显示',hide:'隐藏',copy:'复制',copied:'已复制',copyFailed:'复制失败'}:{empty:'No data',noResults:'No results',more:'Show all',less:'Show less',loadMore:'Load more',total:'Total',select:'Select…',remove:'Remove',search:'search',count:'Count',show:'Show',hide:'Hide',copy:'Copy',copied:'Copied',copyFailed:'Copy failed'};

const subscribe=(notify:()=>void)=>{if(typeof document==='undefined'||typeof MutationObserver==='undefined')return()=>undefined;const observer=new MutationObserver(notify);observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});return()=>observer.disconnect();};
const language=():Locale=>typeof document!=='undefined'&&document.documentElement.lang==='en'?'en':'zh';
const noSubscribe=()=>()=>undefined;
export function useComponentCopy(locale?:Locale){const active=useSyncExternalStore(locale?noSubscribe:subscribe,()=>locale??language(),()=>locale??'zh');return componentCopy(active);}
