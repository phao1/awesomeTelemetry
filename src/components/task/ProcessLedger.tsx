import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TaskRecord, TaskRecordPage } from '../../core/task-types.js';
import { deriveTaskProcess, isProcessGroup, processRecordTitle, type ProcessGroup } from '../../core/task-process.js';
import type { Locale } from '../../i18n.js';
import { processCopy } from './process-copy.js';
import '../../styles/task-ledger.css';

export interface ProcessLedgerHandle { locate: (id: string) => boolean; toggle: (kind: 'round' | 'call') => void }
interface LedgerRow {
  key: string;
  round: ProcessGroup;
  step: ProcessGroup | null;
  call: ProcessGroup | null;
  record: TaskRecord | null;
  collapsedCall: boolean;
}
const stamp = (value: string | undefined, locale: Locale) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const knownCall = (group: ProcessGroup) => group.native !== null && (group.kind === 'attempt' || group.kind === 'tool' && group.basis === 'native');
const representative = (records: TaskRecord[]) => records.filter(item => item.event?.hasOutput || item.importedTurn?.hasOutput).at(-1) ?? records[0]!;
const labels = {
  zh: { user: '用户', assistant: '助手', reasoning: '思考', tool: '工具', context: '上下文', system: '系统', model: '模型请求', metadata: '记录信息', records: '条原始记录', sequence: '原始序号', member: '执行者', identity: '保留的身份', noIdentity: '未提供尝试身份', localStep: '本页步骤', expandCall: '展开调用原始记录', collapseCall: '收起调用原始记录', expandRound: '展开轮次', collapseRound: '折叠轮次' },
  en: { user: 'User', assistant: 'Assistant', reasoning: 'Thinking', tool: 'Tool', context: 'Context', system: 'System', model: 'Model request', metadata: 'Record information', records: 'original records', sequence: 'Original sequence', member: 'Member', identity: 'Retained identity', noIdentity: 'Attempt identity unavailable', localStep: 'Page-local step', expandCall: 'Expand original call records', collapseCall: 'Collapse original call records', expandRound: 'Expand round', collapseRound: 'Collapse round' },
};
const kindOf = (item: TaskRecord): keyof Pick<typeof labels.en, 'user' | 'assistant' | 'reasoning' | 'tool' | 'context' | 'system' | 'model'> => {
  if (item.importedTurn) return 'model';
  const event = item.event;
  if (event?.kind === 'user_prompt') return 'user';
  if (event?.kind === 'reasoning' && (event.title || event.hasOutput)) return 'reasoning';
  if (event && ['tool', 'bash', 'file_read', 'file_write', 'test'].includes(event.kind)) return 'tool';
  if (event?.kind === 'system') return 'system';
  if (event && ['llm', 'message'].includes(event.kind) && event.title !== 'token_count') return 'assistant';
  return 'context';
};

/** Compact original-record rows, borrowing DSH's kind chips and exact selection.
 * The enclosing task page owns scrolling. Expanding metadata never reads bodies. */
export function ProcessLedger({ page, selected, locale, onSelect, onAnchor, onUserScroll, scrollElement, stickyOffset = 0, roundsCollapsed, callsCollapsed, visibleRecordIds, ref }: {
  page: TaskRecordPage; selected: string | null; locale: Locale; onSelect: (item: TaskRecord) => void;
  onAnchor: (id: string) => void; onUserScroll: () => void; scrollElement?: HTMLElement | null; stickyOffset?: number;
  roundsCollapsed?: boolean; callsCollapsed?: boolean; visibleRecordIds?: ReadonlySet<string>; ref?: Ref<ProcessLedgerHandle>;
}) {
  const c = processCopy(locale), l = labels[locale], parent = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set()), [revealed, setRevealed] = useState<Set<string>>(new Set()), [metadata, setMetadata] = useState<Set<string>>(new Set());
  const [localRounds, setLocalRounds] = useState(false), [localCalls, setLocalCalls] = useState(false), [scrollMargin, setScrollMargin] = useState(0), [locatedRecord, setLocatedRecord] = useState<string | null>(null);
  // Presentation-only filtering: native group derivation always retains the full
  // metadata page, including identity carriers hidden from ordinary reading.
  const isVisibleRecord = useCallback((item: TaskRecord) => !visibleRecordIds || visibleRecordIds.has(item.id) || item.id === selected || item.id === locatedRecord, [visibleRecordIds, selected, locatedRecord]);
  const foldRounds = roundsCollapsed ?? localRounds, foldCalls = callsCollapsed ?? localCalls;
  const groups = useMemo(() => deriveTaskProcess(page), [page]);
  const context = useMemo(() => {
    const rounds = new Map<string, number>(), steps = new Map<string, number>(), parents = new Map<string, ProcessGroup[]>();
    groups.forEach((round, index) => {
      rounds.set(round.key, index + 1);
      round.children.filter(isProcessGroup).filter(group => group.kind === 'step').forEach((step, index) => steps.set(step.key, index + 1));
      const visit = (group: ProcessGroup, ancestors: ProcessGroup[]) => { for (const child of group.children) { if (isProcessGroup(child)) visit(child, [...ancestors, group]); else parents.set(child.id, [...ancestors, group]); } };
      visit(round, []);
    });
    return { rounds, steps, parents };
  }, [groups]);
  const rows = useMemo(() => {
    const output: LedgerRow[] = [];
    for (const round of groups) {
      if (!round.records.some(isVisibleRecord)) continue;
      output.push({ key: round.key, round, step: null, call: null, record: null, collapsedCall: false });
      if (folded.has(round.key) || foldRounds && !revealed.has(round.key) && !round.records.some(item => item.id === selected)) continue;
      const visit = (group: ProcessGroup, step: ProcessGroup | null, call: ProcessGroup | null) => {
        const currentStep = group.kind === 'step' ? group : step, currentCall = knownCall(group) ? group : call;
        const visible = group.records.filter(isVisibleRecord);
        if (!visible.length) return;
        if (knownCall(group) && foldCalls && !revealed.has(group.key) && !group.records.some(item => item.id === selected)) {
          output.push({ key: 'call:' + group.key, round, step: currentStep, call: group, record: representative(visible), collapsedCall: true }); return;
        }
        for (const child of group.children) {
          if (isProcessGroup(child)) visit(child, currentStep, currentCall);
          else if (isVisibleRecord(child)) output.push({ key: child.id, round, step: currentStep, call: currentCall, record: child, collapsedCall: false });
        }
      };
      visit(round, null, null);
    }
    return output;
  }, [groups, folded, foldRounds, foldCalls, revealed, selected, isVisibleRecord]);
  const measureScrollMargin = useCallback(() => {
    const node = parent.current, root = scrollElement;
    return node && root ? Math.max(0, node.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop) : 0;
  }, [scrollElement]);
  const updateScrollMargin = useCallback(() => {
    const offset = measureScrollMargin();
    setScrollMargin(value => Math.abs(value - offset) < 0.5 ? value : offset);
  }, [measureScrollMargin]);
  useLayoutEffect(() => {
    const node = parent.current, root = scrollElement;
    if (!node || !root) { setScrollMargin(0); return; }
    const update = updateScrollMargin;
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update); observer?.observe(root); observer?.observe(node);
    // A preceding disclosure can move this ledger without resizing either node.
    // Measuring on root scroll catches that shift without fighting user scroll.
    root.addEventListener('scroll', update, { passive: true });
    return () => { observer?.disconnect(); root.removeEventListener('scroll', update); };
  }, [scrollElement, stickyOffset, page.window, page.offset, updateScrollMargin]);
  const list = useVirtualizer({ count: rows.length, getScrollElement: () => scrollElement ?? parent.current, estimateSize: index => rows[index]?.record ? metadata.has(rows[index]!.record!.id) ? 170 : 34 : 24, overscan: 6, getItemKey: index => rows[index]!.key, scrollMargin, scrollPaddingStart: stickyOffset + 4 });
  const pending = useRef<string | null>(null), positioned = useRef(''), focused = useRef<string | null>(null), lastWindow = useRef(page.window);
  const reveal = (id: string) => {
    const ancestors = context.parents.get(id); if (!ancestors) return false;
    pending.current = id;
    setLocatedRecord(id);
    // Always remeasure explicit navigation, even for an already selected ID.
    updateScrollMargin();
    setFolded(current => { const next = new Set(current); ancestors.forEach(group => next.delete(group.key)); return next; });
    setRevealed(current => { const next = new Set(current); ancestors.forEach(group => next.add(group.key)); return next; });
    return true;
  };
  useEffect(() => { if (lastWindow.current !== page.window) { lastWindow.current = page.window; setFolded(new Set()); setRevealed(new Set()); setMetadata(new Set()); setLocatedRecord(null); } }, [page.window]);
  useEffect(() => { if (selected && selected !== focused.current) reveal(selected); }, [selected, context]);
  useEffect(() => {
    const identity = page.window + ':' + page.offset, target = pending.current ?? selected;
    if (positioned.current === identity && focused.current === selected && !pending.current) return;
    if (Math.abs(measureScrollMargin() - scrollMargin) >= 0.5) { updateScrollMargin(); return; }
    if (target) { const index = rows.findIndex(row => !row.collapsedCall && row.record?.id === target); if (index < 0) return; list.scrollToIndex(index, { align: 'start' }); }
    positioned.current = identity; focused.current = selected; pending.current = null;
  }, [selected, rows, list, page.window, page.offset, scrollElement, scrollMargin, stickyOffset, measureScrollMargin, updateScrollMargin]);
  useEffect(() => {
    if (!scrollElement) return;
    scrollElement.addEventListener('wheel', onUserScroll, { passive: true }); scrollElement.addEventListener('touchstart', onUserScroll, { passive: true });
    return () => { scrollElement.removeEventListener('wheel', onUserScroll); scrollElement.removeEventListener('touchstart', onUserScroll); };
  }, [scrollElement, onUserScroll]);
  useImperativeHandle(ref, () => ({ locate: reveal, toggle: kind => { if (kind === 'round') { setLocalRounds(value => !value); setFolded(new Set()); } else setLocalCalls(value => !value); setRevealed(new Set()); } }));
  const roundName = (round: ProcessGroup) => `${round.records[0]?.importedTurn ? c.importedRound : round.basis === 'continued' ? c.continued : round.basis === 'unavailable' ? c.noRound : c.round} ${context.rounds.get(round.key)}`;
  const toggleRound = (round: ProcessGroup, open: boolean) => {
    setFolded(current => { const next = new Set(current); if (open) next.add(round.key); else next.delete(round.key); return next; });
    if (!open) setRevealed(current => new Set(current).add(round.key));
  };
  return <div className="task-record-scroll process-ledger dsh-process-ledger" data-external-scroll={Boolean(scrollElement)} ref={parent} onWheel={scrollElement ? undefined : onUserScroll} onTouchStart={scrollElement ? undefined : onUserScroll} role="region" aria-label={c.process} title={c.scope}>
    <div className="process-ledger-canvas" style={{ height: list.getTotalSize(), position: 'relative' }}>{list.getVirtualItems().map(virtual => {
      const row = rows[virtual.index]!, item = row.record, next = rows[virtual.index + 1], open = !item && next?.round.key === row.round.key && next.record !== null;
      const call = row.call, kind = item ? kindOf(item) : null, detail = item && metadata.has(item.id), stepNumber = row.step ? context.steps.get(row.step.key) : undefined;
      const offPage = call?.related.find(id => !page.items.some(item => item.id === id));
      const input = Boolean(item?.event?.hasInput), output = Boolean(item?.event?.hasOutput || item?.importedTurn?.hasOutput), error = item?.event?.status === 'error' || item?.importedTurn?.isError;
      return <div key={virtual.key} ref={list.measureElement} data-index={virtual.index} className={`process-stream-row ${item ? 'process-observation' : 'process-round'} ${item?.id === selected ? 'is-selected' : ''}`} style={{ position: 'absolute', width: '100%', transform: `translateY(${virtual.start - scrollMargin}px)` }}>
        {!item ? <div className="process-round-line"><button type="button" className="process-disclosure" aria-label={`${open ? l.collapseRound : l.expandRound} ${roundName(row.round)}`} aria-expanded={Boolean(open)} onClick={() => toggleRound(row.round, Boolean(open))}>{open ? '⌄' : '›'}</button><span className="process-round-label" title={c.scope}>{roundName(row.round)}</span><span className="process-member-chip">{row.round.memberName}</span><button type="button" className="process-round-title" onClick={() => onSelect(row.round.records.find(isVisibleRecord)!)}>{row.round.title || c.scope}</button><span className="process-record-count">{row.round.records.length}</span>{row.round.partial && <span title={c.scope}>◐</span>}</div> : <>
          <div className="process-record-line">
            <button type="button" className="process-disclosure" aria-expanded={Boolean(detail)} aria-label={`${detail ? c.fold : c.unfold} ${l.metadata}: ${processRecordTitle(item)}`} onClick={() => setMetadata(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}>{detail ? '⌄' : '›'}</button>
            <span className="process-step-number" title={row.step?.basis === 'decision_key' ? `${l.localStep} ${stepNumber} · ${c.decision}` : c.noStep}>{row.step?.basis === 'decision_key' ? stepNumber : '·'}</span>
            <span className={`process-kind-chip ${kind}`}>{kind && l[kind]}</span>
            <button type="button" className="process-record-button" data-record-id={item.id} aria-label={`${c.inspect}: ${processRecordTitle(item)}`} aria-current={item.id === selected ? 'true' : undefined} onClick={() => onSelect(item)}><span>{processRecordTitle(item)}</span></button>
            {page.context.task.memberCount > 1 && <span className="process-member-chip" title={item.memberName}>{item.memberName}</span>}
            <span className="process-record-evidence" title={`${input ? c.inputRecords : ''}${input && output ? ' / ' : ''}${output ? c.outputRecords : ''}`}>{input ? '↗' : ''}{output ? '↙' : ''}</span>
            {error && <span className="process-error-count" title={item.event?.error ?? c.errors}>!</span>}
            {row.collapsedCall && call && <button type="button" className="process-call-expand" aria-label={`${l.expandCall}: ${call.title || processRecordTitle(item)}`} onClick={() => setRevealed(current => new Set(current).add(call.key))}>{call.records.length} {l.records} ⌄</button>}
            {offPage && <button type="button" className="process-original-link" title={c.earlier} aria-label={c.earlier} onClick={() => onAnchor(offPage)}>↗</button>}
            <time>{stamp(item.event?.startedAt ?? item.importedTurn?.requestTime ?? undefined, locale)}</time>
          </div>
          {detail && <div className="process-record-metadata"><dl><div><dt>{l.member}</dt><dd>{item.memberName}</dd></div><div><dt>{l.sequence}</dt><dd>#{item.event?.sequence ?? item.importedTurn?.sequence}</dd></div><div><dt>{c.step}</dt><dd>{row.step?.basis === 'decision_key' ? `${l.localStep} ${stepNumber} · ${c.decision}` : c.noStep}</dd></div><div><dt>{call?.kind === 'tool' ? c.tool : c.attempt}</dt><dd>{call?.native ? <>{call.basis === 'decision_key' ? c.associated : c.exact}<code>{JSON.stringify(call.native)}</code></> : l.noIdentity}</dd></div></dl><p>{c.scope}</p>{call && foldCalls && revealed.has(call.key) && <button type="button" onClick={() => setRevealed(current => { const next = new Set(current); next.delete(call.key); return next; })}>{l.collapseCall}</button>}</div>}
        </>}
      </div>;
    })}</div>
  </div>;
}
