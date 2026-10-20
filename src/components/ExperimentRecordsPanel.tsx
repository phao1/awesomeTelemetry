import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionIndexEntry } from '../core/trace-types.js';
import type { Locale } from '../i18n.js';
import { ApiError } from '../api/client.js';
import { experimentRecords } from '../api/experiment-records.js';
import type { ExperimentInput, ExperimentLabel, ExperimentRecord, ExperimentSnapshot } from '../api/experiment-records.js';
import { Drawer, Modal } from './ui/Modal.js';
import '../styles/components/experiment-records.css';

const copy = {
  en: { title: 'Manual experiment records', intro: 'Conditions and result labels are your declarations, not observer-verified facts or quality scores. No experiment, model or tool is executed.', name: 'Experiment name', task: 'Task declaration', inputVersion: 'Input version declaration', modelParameters: 'Model and parameters declaration', toolSet: 'Tool set declaration', mode: 'Comparison conditions', controlled: 'User-declared controlled experiment', natural: 'Natural traffic comparison', unknown: 'Unknown / not declared', empty: 'No manual experiment records yet.', create: 'New record', save: 'Review save', remove: 'Review deletion', confirm: 'Confirm local change', cancel: 'Cancel', refresh: 'Refresh local records', retry: 'Retry local read', loading: 'Reading local records…', writing: 'Saving locally…', close: 'Close panel', dirty: 'Discard unsaved changes?', discard: 'Discard and continue', deleteHint: 'Delete only this manual record. Original sessions and logs remain.', saveHint: 'Confirm saving these manual declarations and result labels on this device.', uncertain: 'Local write outcome is uncertain. Cancel does not roll back a sent write. Refresh successfully and review the saved state before another change.', conflict: 'The reviewed revision differs from the refreshed snapshot. Reselect the saved record or start a new record after reviewing; your draft is retained.', error: 'Local operation failed.', INVALID: 'Review field lengths, required name and JSON limits.', NOT_FOUND: 'This record no longer exists. Refresh and review.', CONFLICT: 'Another writer changed the records. Refresh and review.', BUSY: 'Another writer or crash lock exists. Refresh; a stale lock requires explicit owner inspection.', LIMIT: 'The bounded local record capacity was exceeded.', UNAVAILABLE: 'Local records could not be read or saved safely. Preserve the existing file.', SESSION_UNAVAILABLE: 'A newly linked scan session is unavailable. Review the selected sessions.', TIMEOUT: 'The local wait timed out.', CANCELLED: 'Local waiting cancelled.', runs: 'Linked runs (up to 16)', search: 'Search loaded scan sessions', scope: 'Only the parent’s loaded/filtered scan index is searched (first 50 matches). Missing references remain unavailable in this scope; this does not prove deletion.', add: 'Link run', unlink: 'Unlink run', label: 'Manual result label', note: 'Result explanation', pass: 'Pass (manual)', fail: 'Fail (manual)', mixed: 'Mixed (manual)', unrated: 'Unrated', unavailable: 'Unavailable in loaded index', compare: 'Compare selected runs', compareHint: 'Choose two distinct available runs. Comparing does not verify declared conditions or success.', export: 'Download manual JSON', exported: 'Downloaded the loaded snapshot of manual records.', exportError: 'The local download could not be created.', previous: 'Previous records', next: 'Next records', readSaved: 'Select a saved record to edit or compare.', noRuns: 'No runs linked.', saved: 'Local change confirmed.', run: 'Run', left: 'Left run', right: 'Right run' },
  zh: { title: '手工实验记录', intro: '条件与结果标签均由你声明，不是观测器验证的事实或质量评分。本面板不会执行实验、模型或工具。', name: '实验名称', task: '任务声明', inputVersion: '输入版本声明', modelParameters: '模型与参数声明', toolSet: '工具集声明', mode: '比较条件', controlled: '用户声明的受控实验', natural: '自然流量比较', unknown: '未知／未声明', empty: '尚无手工实验记录。', create: '新建记录', save: '审阅保存', remove: '审阅删除', confirm: '确认本机修改', cancel: '取消', refresh: '刷新本地记录', retry: '重试本地读取', loading: '正在读取本地记录…', writing: '正在保存到本机…', close: '关闭面板', dirty: '放弃未保存的修改？', discard: '放弃并继续', deleteHint: '仅删除这条手工记录，原始会话与日志仍会保留。', saveHint: '确认将这些手工声明与结果标签保存到本机。', uncertain: '本机写入结果不确定。取消不会撤销已发送的写入；再次修改前请成功刷新并审阅保存状态。', conflict: '审阅的版本与刷新结果不同。请审阅后重新选择保存记录或新建记录；草稿仍保留。', error: '本地操作失败。', INVALID: '请检查字段长度、必填名称与 JSON 限制。', NOT_FOUND: '记录已不存在，请刷新并审阅。', CONFLICT: '其他写入者修改了记录，请刷新并审阅。', BUSY: '存在其他写入或崩溃遗留锁。请刷新；清理遗留锁需先明确检查所有者。', LIMIT: '超出本地记录容量上限。', UNAVAILABLE: '无法安全读取或保存本地记录，请保留现有文件。', SESSION_UNAVAILABLE: '新关联的扫描会话不可用，请检查所选会话。', TIMEOUT: '本地等待超时。', CANCELLED: '已取消本地等待。', runs: '关联运行（最多 16 次）', search: '搜索已加载的扫描会话', scope: '仅搜索父级已加载／筛选后的扫描索引，最多显示前 50 个匹配。缺失引用在此范围内不可用，不代表已确认删除。', add: '关联运行', unlink: '取消关联', label: '手工结果标签', note: '结果说明', pass: '通过（手工）', fail: '失败（手工）', mixed: '混合（手工）', unrated: '未评定', unavailable: '在已加载索引中不可用', compare: '比较所选运行', compareHint: '请选择两次不同且可用的运行。比较不会验证声明条件或执行成功。', export: '下载手工 JSON', exported: '已下载当前加载的手工记录快照。', exportError: '无法创建本地下载。', previous: '上一页记录', next: '下一页记录', readSaved: '选择保存记录以编辑或比较。', noRuns: '尚未关联运行。', saved: '本机修改已确认。', run: '运行', left: '左侧运行', right: '右侧运行' },
} as const;
const blank = (): ExperimentInput => ({ name: '', task: null, inputVersion: null, modelParameters: null, toolSet: null, mode: 'natural', runs: [] });
function inputOf(record: ExperimentRecord): ExperimentInput {
  return { name: record.name, task: record.task, inputVersion: record.inputVersion, modelParameters: record.modelParameters, toolSet: record.toolSet, mode: record.mode, runs: record.runs.map(r => ({ ...r })) };
}
type Draft = { id: string | null; revision: number; initial: string; value: ExperimentInput };
export interface ExperimentRecordsPanelProps { sessions: SessionIndexEntry[]; locale: Locale; onClose: () => void; onCompare: (left: string, right: string) => void }

export function ExperimentRecordsPanel({ sessions, locale, onClose, onCompare }: ExperimentRecordsPanelProps): React.JSX.Element {
  const labels = copy[locale];
  const [snapshot, setSnapshot] = useState<ExperimentSnapshot | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<'read' | 'write' | null>(null), [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState(false);
  const [search, setSearch] = useState(''), [page, setPage] = useState(0), [pair, setPair] = useState<string[]>([]), [notice, setNotice] = useState<'saved' | 'exported' | 'exportError' | null>(null);
  const [confirmation, setConfirmation] = useState<'save' | 'delete' | null>(null), [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const owner = useRef<{ token: number; controller: AbortController; timer: ReturnType<typeof setTimeout>; write: boolean } | null>(null), generation = useRef(0);
  const stop = useCallback(() => { generation.current++; if (owner.current) { owner.current.controller.abort(); clearTimeout(owner.current.timer); owner.current = null; } }, []);
  useEffect(() => stop, [stop]);
  const perform = useCallback((write: boolean, loader: (signal: AbortSignal) => Promise<ExperimentSnapshot>, success?: () => void) => {
    if (owner.current) return;
    const token = ++generation.current, controller = new AbortController();
    setBusy(write ? 'write' : 'read'); setError(null); setNotice(null);
    const timer = setTimeout(() => { if (owner.current?.token === token) { stop(); setBusy(null); setError('TIMEOUT'); if (write) setUncertain(true); } }, write ? 10000 : 5000);
    owner.current = { token, controller, timer, write };
    void loader(controller.signal).then(next => {
      if (owner.current?.token !== token) return;
      setSnapshot(next); setUncertain(false); if (write) setNotice('saved'); success?.();
    }).catch((cause: unknown) => {
      if (owner.current?.token !== token) return;
      const reason = cause instanceof ApiError ? cause.details?.reason : null;
      setError(typeof reason === 'string' && reason in copy.en ? reason : 'UNAVAILABLE');
      if (write) setUncertain(true);
    }).finally(() => { if (owner.current?.token === token) { stop(); setBusy(null); } });
  }, [stop]);
  const refresh = useCallback(() => perform(false, experimentRecords.list), [perform]);
  useEffect(() => { refresh(); }, [refresh]);
  const dirty = draft !== null && JSON.stringify(draft.value) !== draft.initial;
  const cancelWait = (): void => { const write = owner.current?.write; stop(); setBusy(null); setError('CANCELLED'); if (write) setUncertain(true); };
  const guarded = (action: () => void): void => { if (dirty || busy === 'write' || uncertain) setDiscardAction(() => action); else action(); };
  const close = (): void => guarded(() => { stop(); onClose(); });
  const select = (record: ExperimentRecord | null): void => guarded(() => {
    if (!snapshot) return;
    const value = record ? inputOf(record) : blank();
    setDraft({ id: record?.id ?? null, revision: snapshot.revision, initial: JSON.stringify(value), value }); setPair([]); setConfirmation(null); setSearch('');
  });
  const update = (patch: Partial<ExperimentInput>): void => setDraft(old => old ? { ...old, value: { ...old.value, ...patch } } : old);
  const scans = useMemo(() => sessions.filter(s => s.dataSource === 'scan'), [sessions]);
  const available = useMemo(() => new Map(scans.map(s => [s.id, s])), [scans]);
  const matches = useMemo(() => scans.filter(s => `${s.title} ${s.id} ${s.sourceAgent}`.toLowerCase().includes(search.toLowerCase())).slice(0, 50), [scans, search]);
  const stale = draft !== null && snapshot !== null && draft.revision !== snapshot.revision;
  const canWrite = !busy && !uncertain && !stale && snapshot !== null;
  const chosen = pair.filter(key => available.has(key) && draft?.value.runs.some(r => r.sessionKey === key));
  const write = (): void => {
    if (!draft || !canWrite || !confirmation) return;
    const action = confirmation === 'delete' ? 'delete' : draft.id ? 'update' : 'create';
    setConfirmation(null);
    perform(true, signal => experimentRecords.write(action, draft.id, draft.revision, draft.value, signal), () => { setDraft(null); setPair([]); });
  };
  const download = (): void => {
    if (!snapshot) return;
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'experiment-records.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0); setNotice('exported');
    } catch { setNotice('exportError'); }
  };
  return <Drawer open title={labels.title} onClose={close} width={850} className="experiment-records">
    <p>{labels.intro}</p>
    <div className="experiment-actions">
      <button className="btn" disabled={!!busy} onClick={refresh}>{error && !uncertain ? labels.retry : labels.refresh}</button>
      <button className="btn" disabled={!snapshot || !!busy || uncertain} onClick={() => select(null)}>{labels.create}</button>
      <button className="btn" disabled={!snapshot || !!busy || uncertain} onClick={download}>{labels.export}</button>
      <button className="btn" onClick={close}>{labels.close}</button>
    </div>
    {busy && <p role="status">{busy === 'read' ? labels.loading : labels.writing} <button className="btn" onClick={cancelWait}>{labels.cancel}</button></p>}
    {error && <p role="alert">{labels.error} {labels[error as keyof typeof labels] ?? labels.UNAVAILABLE}</p>}
    {uncertain && <p role="alert">{labels.uncertain}</p>}
    {notice && <p role="status">{labels[notice]}</p>}
    {snapshot && <>
      {snapshot.records.length === 0 && <p>{labels.empty}</p>}
      <nav aria-label={labels.title} className="experiment-list">{snapshot.records.slice(page * 20, page * 20 + 20).map(record => <button className="btn" key={record.id} aria-pressed={draft?.id === record.id} disabled={!!busy || uncertain} onClick={() => select(record)}>{record.name} · {labels[record.mode]}</button>)}</nav>
      {snapshot.records.length > 20 && <div className="experiment-actions"><button className="btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{labels.previous}</button><span>{page + 1}</span><button className="btn" disabled={(page + 1) * 20 >= snapshot.records.length} onClick={() => setPage(p => p + 1)}>{labels.next}</button></div>}
    </>}
    {!draft && <p>{labels.readSaved}</p>}
    {draft && <>
      {stale && <p role="alert">{labels.conflict}</p>}
      <fieldset disabled={!!busy || confirmation !== null} className="experiment-form"><legend>{draft.id ? draft.value.name : labels.create}</legend>
        <label>{labels.name}<input aria-label={labels.name} maxLength={120} required value={draft.value.name} onChange={e => update({ name: e.target.value })} /></label>
        <label>{labels.mode}<select aria-label={labels.mode} value={draft.value.mode} onChange={e => update({ mode: e.target.value as ExperimentInput['mode'] })}><option value="natural">{labels.natural}</option><option value="controlled">{labels.controlled}</option></select></label>
        {(['task', 'inputVersion', 'modelParameters', 'toolSet'] as const).map(key => <label key={key}>{labels[key]}<textarea aria-label={labels[key]} maxLength={key === 'inputVersion' ? 256 : 2000} placeholder={labels.unknown} value={draft.value[key] ?? ''} onChange={e => update({ [key]: e.target.value.trim() ? e.target.value : null })} /></label>)}
        <h3>{labels.runs}</h3><p>{labels.scope}</p>
        <label>{labels.search}<input aria-label={labels.search} value={search} onChange={e => setSearch(e.target.value)} /></label>
        <div className="experiment-matches">{matches.map(session => <button className="btn" key={session.id} title={session.id} disabled={draft.value.runs.length >= 16 || draft.value.runs.some(r => r.sessionKey === session.id)} onClick={() => update({ runs: [...draft.value.runs, { sessionKey: session.id, label: 'unrated', note: null }] })}>{labels.add}: {session.title || session.id}</button>)}</div>
        {!draft.value.runs.length && <p>{labels.noRuns}</p>}
        {draft.value.runs.map((run, index) => <fieldset key={run.sessionKey} className="experiment-run"><legend>{labels.run} {index + 1}: {available.get(run.sessionKey)?.title || run.sessionKey}</legend><p className="mono">{run.sessionKey}{!available.has(run.sessionKey) && <> · {labels.unavailable}</>}</p>
          <label><input type="checkbox" aria-label={`${labels.compare}: ${run.sessionKey}`} disabled={!available.has(run.sessionKey) || (!pair.includes(run.sessionKey) && pair.length >= 2)} checked={pair.includes(run.sessionKey)} onChange={e => setPair(keys => e.target.checked ? [...keys, run.sessionKey] : keys.filter(k => k !== run.sessionKey))} />{labels.compare}</label>
          <label>{labels.label}<select aria-label={`${labels.label} ${index + 1}`} value={run.label} onChange={e => update({ runs: draft.value.runs.map((r, i) => i === index ? { ...r, label: e.target.value as ExperimentLabel } : r) })}>{(['unrated', 'pass', 'fail', 'mixed'] as const).map(label => <option key={label} value={label}>{labels[label]}</option>)}</select></label>
          <label>{labels.note}<textarea aria-label={`${labels.note} ${index + 1}`} maxLength={2000} value={run.note ?? ''} onChange={e => update({ runs: draft.value.runs.map((r, i) => i === index ? { ...r, note: e.target.value.trim() ? e.target.value : null } : r) })} /></label>
          <button className="btn" onClick={() => { update({ runs: draft.value.runs.filter((_, i) => i !== index) }); setPair(keys => keys.filter(k => k !== run.sessionKey)); }}>{labels.unlink}</button>
        </fieldset>)}
      </fieldset>
      <p>{labels.compareHint}</p>
      {chosen.map((key, index) => <p key={key}>{index === 0 ? labels.left : labels.right}: {available.get(key)?.title || key}</p>)}
      <div className="experiment-actions"><button className="btn" disabled={chosen.length !== 2 || !!busy || dirty || uncertain || stale} onClick={() => { onCompare(chosen[0]!, chosen[1]!); onClose(); }}>{labels.compare}</button><button className="btn" disabled={!canWrite || !draft.value.name.trim()} onClick={() => setConfirmation('save')}>{labels.save}</button>{draft.id && <button className="btn" disabled={!canWrite} onClick={() => setConfirmation('delete')}>{labels.remove}</button>}</div>
    </>}
    {confirmation && <Modal title={confirmation === 'delete' ? labels.remove : labels.save} onClose={() => setConfirmation(null)} size="sm"><p>{confirmation === 'delete' ? labels.deleteHint : labels.saveHint}</p><p>{draft?.value.name} · {draft?.id ?? labels.create} · revision {draft?.revision}</p><div className="experiment-actions"><button className="btn" onClick={() => setConfirmation(null)}>{labels.cancel}</button><button className="btn" onClick={write}>{labels.confirm}</button></div></Modal>}
    {discardAction && <Modal title={labels.dirty} onClose={() => setDiscardAction(null)} size="sm"><p>{labels.dirty}</p>{(busy === 'write' || uncertain) && <p>{labels.uncertain}</p>}<div className="experiment-actions"><button className="btn" onClick={() => setDiscardAction(null)}>{labels.cancel}</button><button className="btn" onClick={() => { const action = discardAction; setDiscardAction(null); action(); }}>{labels.discard}</button></div></Modal>}
  </Drawer>;
}
