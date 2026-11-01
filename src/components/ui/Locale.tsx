import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { t, type I18nKey, type Locale } from '../../i18n.js';
const UiLocale=createContext<Locale|null>(null);
export function UiLocaleProvider({locale,children}:{locale:Locale;children:ReactNode}):React.JSX.Element{return <UiLocale.Provider value={locale}>{children}</UiLocale.Provider>;}
const subscribe=(notify:()=>void)=>{if(typeof document==='undefined'||typeof MutationObserver==='undefined')return()=>undefined;const observer=new MutationObserver(notify);observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});return()=>observer.disconnect();};
const language=():Locale=>typeof document!=='undefined'&&document.documentElement.lang.startsWith('en')?'en':'zh';
const noSubscribe=()=>()=>undefined;
export function useUiLocale(locale?:Locale):Locale { const context=useContext(UiLocale);const fallback=useSyncExternalStore(locale??context?noSubscribe:subscribe,language,()=> 'zh' as Locale);return locale??context??fallback; }
const componentCopy=(locale:Locale)=>locale==='zh'?{empty:'暂无数据',noResults:'无匹配项',more:'查看全部',less:'收起',loadMore:'加载更多',total:'总计',select:'请选择…',remove:'移除',search:'搜索',count:'数量',show:'显示',hide:'隐藏',copy:'复制',copied:'已复制',copyFailed:'复制失败'}:{empty:'No data',noResults:'No results',more:'Show all',less:'Show less',loadMore:'Load more',total:'Total',select:'Select…',remove:'Remove',search:'search',count:'Count',show:'Show',hide:'Hide',copy:'Copy',copied:'Copied',copyFailed:'Copy failed'};

export function useUiCopy(locale?:Locale){return componentCopy(useUiLocale(locale));}

/** Accessibility and visible labels share the same active locale as other UI copy. */
export function useUiTranslate(locale?:Locale){
 const active=useUiLocale(locale);
 return (key:I18nKey,vars?:Record<string,string>)=>Object.entries(vars??{}).reduce((value,[name,replacement])=>value.replaceAll(`{${name}}`,replacement),t(key,active));
}
