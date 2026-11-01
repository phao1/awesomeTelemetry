import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fetchJson } from '../api/client.js';
import { PROVIDER_KEYS, type LocalSessionConfig, type ProviderKey } from '../core/trace-types.js';
import type { AlertThresholds, LocalSettingsTarget } from '../core/task-types.js';
import { ALERT_LABELS } from '../core/task-alerts.js';
import { t, type Locale } from '../i18n.js';
import type { ThemePreference } from '../theme.js';
import type { SettingsSection } from '../settings-route.js';
import { PageHeader } from './PageHeader.js';
import { Button } from './ui/Button.js';
import { Input } from './ui/Input.js';
import { Switch, SegmentedControl } from './ui/Controls.js';
import { Card, CardBody, CardHeader, Callout } from './ui/Display.js';
import { Field } from './ui/Field.js';
import { Skeleton, Toast } from './ui/States.js';
import { isDesensitizationEnabled, setDesensitizationEnabled } from './inspector-text.js';
import { useSettingsDraft } from './settings/use-settings-draft.js';
import { settingsCopy } from './settings/copy.js';
import '../styles/components/settings.css';
export interface SettingsModalProps {
 appearance?:{theme:ThemePreference;onTheme:(value:ThemePreference)=>void;fontPx:number;onFont:(value:number)=>void;onLocale:(value:Locale)=>void};
 section?:SettingsSection;onSectionChange?:(section:SettingsSection)=>void;
 initialTarget?:LocalSettingsTarget;onSettingsSaved?:()=>void;locale:Locale;
 /** Kept source-compatible with old callers; settings no longer opens a dialog. */
 onClose?:()=>void;onSearch?:()=>void;onMenu?:()=>void;
 load?:(signal?:AbortSignal)=>Promise<unknown>;save?:(config:unknown,signal?:AbortSignal)=>Promise<unknown>;
}
const defaultLoad=(signal?:AbortSignal)=>api.configProviders(signal);
const defaultSave=(value:unknown,signal?:AbortSignal)=>api.saveConfigProviders(value,signal);
function validConfig(value:unknown):value is LocalSessionConfig {
 if(typeof value!=='object'||value===null)return false;const record=value as Record<string,unknown>;
 if(typeof record.providers!=='object'||record.providers===null||!Number.isFinite(record.prewarmRecent)||!(record.traeKeyPath===null||typeof record.traeKeyPath==='string'))return false;
 return PROVIDER_KEYS.every(key=>{const provider=(record.providers as Record<string,unknown>)[key];if(typeof provider!=='object'||provider===null)return false;const item=provider as Record<string,unknown>;return item.key===key&&typeof item.enabled==='boolean'&&typeof item.path==='string'&&typeof item.label==='string'&&typeof item.sourceKind==='string'&&['jsonl','json','sqlite','sqlcipher','otel'].includes(item.sourceKind)&&(item.watchStrategy==='chokidar'||item.watchStrategy==='poll')&&Number.isFinite(item.pollIntervalMs);});
}
function validAlerts(value:unknown):value is AlertThresholds {
 if(!value||typeof value!=='object')return false;const row=value as Record<string,unknown>,keys=Object.keys(ALERT_LABELS);
 return Object.keys(row).length===keys.length&&keys.every(key=>row[key]===null||typeof row[key]==='number'&&Number.isFinite(row[key])&&row[key]>=0&&(key.endsWith('Pct')?row[key]<=100:Number.isSafeInteger(row[key])));
}
export function SettingsPage({locale,appearance,section:controlledSection,onSectionChange,initialTarget,onSettingsSaved,onSearch,onMenu,load=defaultLoad,save=defaultSave}:SettingsModalProps):React.JSX.Element {
 const zh=locale==='zh',copy=settingsCopy(locale);
 const [ownSection,setOwnSection]=useState<SettingsSection>(initialTarget?.section??'general'),[saved,setSaved]=useState(false),[desensitize,setDesensitize]=useState(isDesensitizationEnabled);
 const section=controlledSection??ownSection;
 const choose=(value:SettingsSection)=>{setOwnSection(value);onSectionChange?.(value);};
 const providers=useSettingsDraft<LocalSessionConfig>({prefix:'CONFIG',load,save,validate:validConfig});
 const loadAlerts=useCallback((signal?:AbortSignal)=>fetchJson<AlertThresholds>('/config/alert-thresholds',{signal}),[]);
 const saveAlerts=useCallback((value:AlertThresholds,signal?:AbortSignal)=>fetchJson('/config/alert-thresholds',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(value),signal}),[]);
 const alerts=useSettingsDraft<AlertThresholds>({prefix:'ALERT',enabled:section==='alert-thresholds',load:loadAlerts,save:saveAlerts,validate:validAlerts});
 const pageRef=useRef<HTMLElement>(null),focused=useRef('');
 useEffect(()=>{if(section!=='alert-thresholds'||!alerts.draft||focused.current===section){if(section!=='alert-thresholds')focused.current='';return;}focused.current=section;const frame=requestAnimationFrame(()=>pageRef.current?.querySelector<HTMLInputElement>('#settings-alert-thresholds input')?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame);},[section,alerts.draft]);
 const busy=providers.busy!==null||alerts.busy!==null,dirty=providers.dirty||alerts.dirty,uncertain=providers.uncertain||alerts.uncertain;
 const saving=useRef(false),mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const submit=async()=>{if(saving.current||busy||uncertain||!dirty)return;saving.current=true;setSaved(false);try{if(providers.dirty){if(!await providers.save()||!mounted.current)return;onSettingsSaved?.();}if(alerts.dirty){if(!await alerts.save()||!mounted.current)return;onSettingsSaved?.();}if(mounted.current)setSaved(true);}finally{saving.current=false;}};
 const edit=(key:ProviderKey,patch:{enabled?:boolean;path?:string})=>{providers.setDraft(value=>value?{...value,providers:{...value.providers,[key]:{...value.providers[key],...patch}}}:value);setSaved(false);};
 const feedback=[{key:'providers',resource:providers},{key:'alerts',resource:alerts}].filter(({resource})=>resource.error||resource.uncertain);
 return <main ref={pageRef} className="settings-page"><PageHeader locale={locale} title={t('settings.title',locale)} description={copy.description} onSearch={onSearch} onMenu={onMenu}/>
  <div className="settings-layout"><nav className="settings-nav" aria-label={copy.navigation}>{copy.sections.map(([id,label])=><Button key={id} variant="ghost" aria-current={section===id?'page':undefined} onClick={()=>choose(id)}>{label}</Button>)}</nav>
  <div className="settings-content">
   {feedback.map(({resource,key})=><Callout key={key} tone="danger" title={resource.uncertain?t('settings.uncertain',locale):resource.error}>{resource.error&&<><code>{resource.error}</code><p>{t(resource.errorKind==='load'?'settings.loadFailed':'settings.saveFailed',locale)}</p></>}<Button disabled={busy} onClick={()=>void resource.load()}>{key==='providers'?t('settings.reload',locale):zh?'重新读取阈值':'Reload thresholds'}</Button></Callout>)}
   {section==='general'&&<Card><CardHeader title={copy.sections[0][1]}/><CardBody><Field label={t('settings.desensitize',locale)} hint={t('settings.desensitizeHint',locale)}><Switch aria-label={t('settings.desensitize',locale)} checked={desensitize} onChange={event=>{setDesensitize(event.target.checked);setDesensitizationEnabled(event.target.checked);setSaved(true);}}/></Field><Callout title={t('settings.scope',locale)}/></CardBody></Card>}
   {section==='appearance'&&<Card><CardHeader title={copy.sections[1][1]}/><CardBody>
    <Field label={copy.theme} hint={copy.themeHint}><SegmentedControl activeId={appearance?.theme??'system'} items={[{id:'light',label:zh?'浅色':'Light'},{id:'dark',label:zh?'深色':'Dark'},{id:'system',label:zh?'跟随系统':'System'}]} onChange={id=>{appearance?.onTheme(id as ThemePreference);setSaved(true);}}/></Field>
    <Field label={copy.language} hint={copy.languageHint}><SegmentedControl activeId={locale} items={[{id:'zh',label:zh?'简体中文':'Simplified Chinese'},{id:'en',label:zh?'英语':'English'}]} onChange={id=>{appearance?.onLocale(id as Locale);setSaved(true);}}/></Field>
    <Field label={copy.font} hint={copy.fontHint}><SegmentedControl activeId={String(appearance?.fontPx??13)} items={[{id:'12',label:zh?'小':'Small'},{id:'13',label:zh?'标准':'Standard'},{id:'14',label:zh?'大':'Large'}]} onChange={id=>{appearance?.onFont(Number(id));setSaved(true);}}/></Field>
   </CardBody></Card>}
   {section==='health'&&<Card><CardHeader title={copy.sections[2][1]}/><CardBody><Callout title={zh?'在任务中运行健康分析':'Run health analysis from a task'}>{zh?'打开任务的“健康监测”查看覆盖率、规则与证据；告警阈值只在本地标记。':'Open Health monitoring on a task to inspect coverage, rules and evidence. Alert thresholds mark local records.'}</Callout></CardBody></Card>}
   {section==='alert-thresholds'&&<Card id="settings-alert-thresholds"><CardHeader title={copy.sections[3][1]} description={copy.alertsHint}/><CardBody>{alerts.busy==='load'&&<Skeleton variant="row" count={3}/>}<fieldset disabled={busy||alerts.uncertain} className="local-alert-editor"><legend hidden>{copy.sections[3][1]}</legend>{alerts.draft&&(Object.keys(ALERT_LABELS) as Array<keyof AlertThresholds>).map(key=><Field key={key} label={ALERT_LABELS[key][zh?0:1]} hint={copy.alertsHint}><Input aria-label={ALERT_LABELS[key][zh?0:1]} type="number" min={0} max={key.endsWith('Pct')?100:undefined} step={key.endsWith('Pct')?'any':1} value={alerts.draft![key]??''} onChange={event=>{alerts.setDraft(value=>value?{...value,[key]:event.target.value===''?null:Number(event.target.value)}:value);setSaved(false);}}/></Field>)}</fieldset></CardBody></Card>}
   {section==='storage'&&<Card><CardHeader title={copy.sections[4][1]} description={t('settings.providerHint',locale)} actions={<Button disabled={busy||providers.dirty&&!providers.uncertain} onClick={()=>void providers.load()}>{t('settings.reload',locale)}</Button>}/><CardBody>{providers.busy==='load'&&<Skeleton variant="row" count={5}/>}<fieldset className="settings-provider-list" disabled={busy||providers.uncertain}>{providers.draft&&PROVIDER_KEYS.map(key=>{const provider=providers.draft!.providers[key],label=provider.label||key;return <section className="settings-provider" key={key} aria-label={label}><h3>{label}</h3><Field label={t('settings.enabled',locale)} hint={copy.enabledHint}><Switch data-provider-enabled={key} aria-label={label+' · '+t('settings.enabled',locale)} checked={provider.enabled} onChange={event=>edit(key,{enabled:event.target.checked})}/></Field><Field label={t('settings.path',locale)} hint={copy.pathHint}><Input data-provider-path={key} aria-label={label+' · '+t('settings.path',locale)} value={provider.path} onChange={event=>edit(key,{path:event.target.value})}/></Field></section>;})}</fieldset></CardBody></Card>}
   {section==='about'&&<Card><CardHeader title="AwesomeTelemetry"/><CardBody><p>{zh?'本地 Agent 可观测性 · 版本 0.1.0':'Local Agent observability · Version 0.1.0'}</p></CardBody></Card>}
   {(dirty||providers.busy==='save'||alerts.busy==='save')&&<div className="settings-savebar" role="region" aria-label={copy.unsaved}><span role="status">{providers.busy==='save'||alerts.busy==='save'?t('settings.saving',locale):copy.unsaved}</span><Button disabled={busy||uncertain} onClick={()=>{providers.discard();alerts.discard();setSaved(false);}}>{copy.discard}</Button><Button variant="primary" loading={providers.busy==='save'||alerts.busy==='save'} disabled={busy||uncertain||!dirty} onClick={()=>void submit()}>{copy.save}</Button></div>}
  </div></div>{saved&&<Toast title={t('settings.saved',locale)} tone="success" onDismiss={()=>setSaved(false)}/>}
 </main>;
}
/** Compatibility export for integrations importing the former component name. */
export const SettingsModal=SettingsPage;
