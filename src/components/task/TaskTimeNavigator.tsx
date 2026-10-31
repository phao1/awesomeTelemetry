import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { TaskRecord, TaskStructure, TaskTimeline } from '../../core/task-types.js';
import { fitTimeRange, processInterval, processRecordTitle } from '../../core/task-process.js';
import type { Locale } from '../../i18n.js';
import { processCopy } from './process-copy.js';
import '../../styles/task-timeline.css';

type Range = [number, number];
type Kind = 'input' | 'model' | 'tool' | 'context';
interface Mark { record: TaskRecord; interval: Range | null; start: number; end: number; kind: Kind }
interface Gesture { pointer: number; x: number; start: number; view: Range; pan: boolean; record: string | null }
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const zoomRange = (domain: Range, view: Range, factor: number, duration: boolean, anchor = 0.5): Range => {
  const full = domain[1] - domain[0], minimum = Math.min(duration ? 20 : 4, full);
  const width = Math.min(full, Math.max(minimum, (view[1] - view[0]) * factor));
  const point = view[0] + (view[1] - view[0]) * anchor;
  return fitTimeRange(domain, [point - width * anchor, point + width * (1 - anchor)]);
};
const kindOf = (record: TaskRecord): Kind => {
  const event = record.event;
  if (!event) return 'model';
  if (event.kind === 'user_prompt') return 'input';
  if (['tool', 'bash', 'file_read', 'file_write', 'test'].includes(event.kind)) return 'tool';
  if (event.title === 'token_count' || event.kind === 'reasoning' && !event.title && !event.hasOutput) return 'context';
  return ['llm', 'reasoning', 'message'].includes(event.kind) ? 'model' : 'context';
};
const labels = {
  zh: { title: '任务轨迹', duration: '时长', input: '输入', model: '模型', tool: '工具', context: '上下文', page: '本页', records: '条', unknown: '条时间未知', sequence: '默认按本页记录顺序等宽展示，不代表执行耗时。点击色块定位原始记录；滚轮缩放、右键拖动平移，拖动空白放大。', actual: '按本页已保留的日志时间绘制；未知耗时为点，不表示模型推理耗时。拖动筛选时间，双击或 Esc 清除。', fit: '复位轨迹图', keyboard: '左右键选择记录；上下键平移，＋/−缩放，Home复位，Esc清除时间筛选。', start: '记录时间', span: '日志区间', noDuration: '耗时未提供', sequencePosition: '本页记录', full: '当前任务范围共', empty: '本页没有可绘制的记录', noTime: '本页记录未提供时间；关闭“时长”可按记录顺序查看。', choices: '此处重叠的记录', closeChoices: '关闭记录选择', clear: '清除时间筛选', filter: '时间已筛选', partial: '仅绘制本页精确记录；前后页通过记录分页读取。' },
  en: { title: 'Task trajectory', duration: 'Duration', input: 'Input', model: 'Model', tool: 'Tools', context: 'Context', page: 'Page', records: 'records', unknown: 'without timestamps', sequence: 'Equal-width current-page records, not execution duration. Click a block to locate its original record; wheel zooms, right drag pans, drag whitespace to zoom.', actual: 'Retained timestamps on this page. Unknown durations are points, not model inference timings. Drag to filter time; double-click or Escape clears.', fit: 'Reset trajectory', keyboard: 'Left/right selects records; up/down pans, +/− zooms, Home resets, Escape clears the time filter.', start: 'Recorded time', span: 'Log interval', noDuration: 'Duration unavailable', sequencePosition: 'Page record', full: 'Current task scope contains', empty: 'No records on this page', noTime: 'No timestamps on this page. Turn Duration off to browse in record order.', choices: 'Overlapping records here', closeChoices: 'Close record choices', clear: 'Clear time filter', filter: 'Time filtered', partial: 'Only exact records on this page are plotted; use record pagination for earlier/later pages.' },
};

/** Single-row reading refinement of the DSH interaction pattern.
 * Every block is one loaded original record, never an aggregate histogram bin. */
export function TaskTimeNavigator({ timeline, loading, error, onRetry, records, structure, selected, range, onRangeChange, onSelect, locale, toolbar }: {
  timeline: TaskTimeline | null; loading: boolean; error: string | null; onRetry: () => void;
  records: TaskRecord[]; structure?: TaskStructure; selected: string | null; range: Range | null;
  onRangeChange: (range: Range | null) => void; onSelect: (item: TaskRecord) => void;
  locale: Locale; mainMemberId?: string; toolbar?: ReactNode;
}) {
  const c = labels[locale === 'zh' ? 'zh' : 'en'], legacy = processCopy(locale);
  const track = useRef<SVGSVGElement>(null), gesture = useRef<Gesture | null>(null), suppressClick = useRef(false);
  const [duration, setDuration] = useState(false), [viewport, setViewport] = useState<Range | null>(null);
  const [draft, setDraft] = useState<Range | null>(null), [hover, setHover] = useState<{ id: string; fraction: number } | null>(null);
  const [tooltip, setTooltip] = useState<typeof hover>(null);
  const [choices, setChoices] = useState<{ ids: string[]; fraction: number } | null>(null);
  const choicePanel = useRef<HTMLDivElement>(null);
  const marks = useMemo<Mark[]>(() => records.flatMap((record, index) => {
    const interval = processInterval(record), kind = kindOf(record);
    if (duration && !interval) return [];
    return [{ record, interval, start: duration ? interval![0] : index, end: duration ? interval![1] : index + 1, kind }];
  }), [records, duration]);
  const domain = useMemo<Range>(() => marks.length ? [Math.min(...marks.map(mark => mark.start)), Math.max(...marks.map(mark => mark.end), marks[0]!.start + 1)] : [0, 1], [marks]);
  const current = viewport ? fitTimeRange(domain, viewport) : domain, width = Math.max(1, current[1] - current[0]);
  const live = useRef({ current, domain, duration, marks });
  live.current = { current, domain, duration, marks };
  const missingTime = records.length - records.filter(record => processInterval(record)).length;
  const roundRecords = useMemo(() => new Set([
    ...records.filter(record => record.event?.kind === 'user_prompt').map(record => record.id),
    ...(structure?.leading ?? []).map(seed => seed.recordId),
  ]), [records, structure]);
  const visible = marks.filter(mark => mark.end >= current[0] && mark.start <= current[1]);
  const selectedMark = marks.find(mark => mark.record.id === selected);
  useEffect(() => setChoices(null), [viewport]);
  const painted = [...visible.filter(mark => mark.record.id !== selected), ...visible.filter(mark => mark.record.id === selected)];
  const geometry = (mark: Mark) => {
    const x = Math.max(0, (mark.start - current[0]) / width * 1000), right = Math.min(1000, (mark.end - current[0]) / width * 1000);
    const markWidth = Math.max(5, Number((right - x - (duration ? 0 : 1)).toFixed(3)));
    return { x: Math.min(x, 1000 - markWidth), width: markWidth };
  };
  useEffect(() => { setViewport(null); setDraft(null); setHover(null); setChoices(null); }, [duration, records]);
  useEffect(() => { if (choices) choicePanel.current?.querySelector<HTMLButtonElement>('[data-record-choice]')?.focus(); }, [choices]);
  useEffect(() => {
    if (!selectedMark) return;
    setViewport(previous => {
      if (!previous || selectedMark.end >= previous[0] && selectedMark.start <= previous[1]) return previous;
      const span = previous[1] - previous[0];
      return fitTimeRange(domain, [selectedMark.start - span / 2, selectedMark.start + span / 2]);
    });
  }, [selected, selectedMark, domain]);
  useEffect(() => {
    setTooltip(null);
    if (!hover) return;
    const timer = setTimeout(() => setTooltip(hover), 250);
    return () => clearTimeout(timer);
  }, [hover]);
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect(), state = live.current;
      setViewport(zoomRange(state.domain, state.current, Math.exp(Math.max(-1, Math.min(1, event.deltaY * 0.003))), state.duration, clamp((event.clientX - rect.left) / Math.max(1, rect.width))));
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [marks.length]);
  const reset = () => { setViewport(null); setDraft(null); setChoices(null); };
  const fractionAt = (x: number) => { const rect = track.current?.getBoundingClientRect(); return clamp((x - (rect?.left ?? 0)) / Math.max(1, rect?.width ?? 1)); };
  const recordAt = (event: PointerEvent<SVGSVGElement>) => event.target instanceof Element ? event.target.closest('[data-record-id]')?.getAttribute('data-record-id') ?? null : null;
  const pick = (record: TaskRecord) => { setTooltip(null); setChoices(null); onSelect(record); };
  const pickAt = (record: TaskRecord, fraction: number) => {
    const hits = duration ? visible.filter(mark => { const box = geometry(mark); return fraction * 1000 >= box.x && fraction * 1000 <= box.x + box.width; }) : [];
    if (hits.length > 1) { setTooltip(null); setChoices({ ids: hits.map(mark => mark.record.id), fraction }); }
    else pick(record);
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault(); event.currentTarget.focus(); suppressClick.current = false; setChoices(null);
    gesture.current = { pointer: event.pointerId, x: event.clientX, start: current[0] + fractionAt(event.clientX) * width, view: current, pan: event.button === 2 || event.altKey, record: recordAt(event) };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const id = recordAt(event); setHover(id ? { id, fraction: fractionAt(event.clientX) } : null);
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    const at = current[0] + fractionAt(event.clientX) * width;
    if (active.pan) {
      const rect = event.currentTarget.getBoundingClientRect(), delta = (event.clientX - active.x) / Math.max(1, rect.width) * (active.view[1] - active.view[0]);
      setViewport(fitTimeRange(domain, [active.view[0] - delta, active.view[1] - delta]));
    } else if (Math.abs(event.clientX - active.x) >= 3) setDraft([Math.min(active.start, at), Math.max(active.start, at)]);
  };
  const finish = (event: PointerEvent<SVGSVGElement>) => {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    gesture.current = null; setDraft(null); suppressClick.current = true;
    if (active.pan) return;
    if (Math.abs(event.clientX - active.x) < 3) {
      const exact = records.find(record => record.id === active.record);
      if (exact) { pickAt(exact, fractionAt(event.clientX)); return; }
      // Whitespace has no original identity. Focus only a real loaded record.
      const point = current[0] + fractionAt(event.clientX) * width;
      const nearest = marks.reduce<Mark | null>((best, mark) => !best || Math.abs((mark.start + mark.end) / 2 - point) < Math.abs((best.start + best.end) / 2 - point) ? mark : best, null);
      if (nearest) pickAt(nearest.record, fractionAt(event.clientX));
      return;
    }
    const at = current[0] + fractionAt(event.clientX) * width, next: Range = [Math.min(active.start, at), Math.max(active.start, at)];
    if (duration) onRangeChange([Math.floor(next[0]), Math.ceil(next[1])]);
    else setViewport(fitTimeRange(domain, next));
  };
  const pan = (direction: number) => setViewport(fitTimeRange(domain, [current[0] + direction * width / 4, current[1] + direction * width / 4]));
  const keyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setViewport(zoomRange(domain, current, 0.5, duration)); }
    else if (event.key === '-') { event.preventDefault(); setViewport(zoomRange(domain, current, 2, duration)); }
    else if (event.key === 'Home' || event.key === '0') { event.preventDefault(); reset(); }
    else if (event.key === 'Escape') { event.preventDefault(); gesture.current = null; setDraft(null); setChoices(null); onRangeChange(null); }
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); pan(event.key === 'ArrowUp' ? -1 : 1); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); const index = marks.findIndex(mark => mark.record.id === selected), next = marks[Math.max(0, Math.min(marks.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)))];
      if (next) pick(next.record);
    }
  };
  const shownRange = draft ?? (duration ? range : null), tip = marks.find(mark => mark.record.id === tooltip?.id);
  const time = (value: number) => new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-GB', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  return <section className="task-trajectory-timeline" aria-label={c.title}>
    <div className="task-trajectory-toolbar">
      <button type="button" className="task-timeline-duration" aria-pressed={duration} title={duration ? c.actual : c.sequence} onClick={() => setDuration(value => !value)}>◷ {c.duration}</button>
      <span className="task-timeline-legend">{(['input', 'model', 'tool', ...(marks.some(mark => mark.kind === 'context') ? ['context'] : [])] as Kind[]).map(kind => <span key={kind} className={`task-timeline-kind ${kind}`}>{c[kind]}</span>)}</span>
      {toolbar}
      <span className="task-timeline-page" title={`${c.partial} ${timeline ? `${c.full} ${timeline.total.toLocaleString()} ${c.records}.` : ''}`}>{c.page} {records.length} {c.records}{missingTime ? ` · ${missingTime} ${c.unknown}` : ''}</span>
      {loading && <span className="task-timeline-loading" role="status" title={legacy.loading}>…</span>}
      {error && <button type="button" className="task-timeline-error" title={error} onClick={onRetry}>{legacy.retry}</button>}
      {range && <button type="button" className="task-timeline-filter" title={c.clear} onClick={() => onRangeChange(null)}>{c.filter} ×</button>}
      <button type="button" aria-label={legacy.zoomIn} title={legacy.zoomIn} disabled={!marks.length} onClick={() => setViewport(zoomRange(domain, current, 0.5, duration))}>＋</button>
      <button type="button" aria-label={legacy.zoomOut} title={legacy.zoomOut} disabled={!marks.length} onClick={() => setViewport(zoomRange(domain, current, 2, duration))}>−</button>
      <button type="button" aria-label={c.fit} title={`${c.fit} · ${duration ? c.actual : c.sequence}`} disabled={!marks.length} onClick={reset}>↺</button>
    </div>
    <div className="task-timeline-plot" title={duration ? c.actual : c.sequence}>
      <svg ref={track} className="task-timeline-track process-time-track" viewBox="0 0 1000 28" preserveAspectRatio="none" tabIndex={0} role="group" aria-label={`${c.title}. ${c.keyboard}`} data-domain-start={current[0]} data-domain-end={current[1]} onKeyDown={keyDown} onPointerDown={down} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { gesture.current = null; setDraft(null); }} onPointerLeave={() => { if (!gesture.current) setHover(null); }} onContextMenu={event => event.preventDefault()} onDoubleClick={() => { reset(); onRangeChange(null); }}>
        {visible.filter(mark => roundRecords.has(mark.record.id)).map(mark => <line key={`round:${mark.record.id}`} x1={(mark.start - current[0]) / width * 1000} x2={(mark.start - current[0]) / width * 1000} y1="0" y2="28" className="task-timeline-round" />)}
        {shownRange && <rect className="task-timeline-selection" x={Math.max(0, (shownRange[0] - current[0]) / width * 1000)} y="0" width={Math.max(1, Math.min(1000, (shownRange[1] - current[0]) / width * 1000) - Math.max(0, (shownRange[0] - current[0]) / width * 1000))} height="28" />}
        {painted.map(mark => {
          const box = geometry(mark);
          const active = mark.record.id === selected, failed = mark.record.event?.status === 'error' || mark.record.importedTurn?.isError;
          return <rect key={mark.record.id} data-record-id={mark.record.id} data-point={duration && mark.start === mark.end || undefined} className={`task-timeline-mark ${mark.kind}${active ? ' is-selected' : ''}${hover?.id === mark.record.id ? ' is-hovered' : ''}${failed ? ' has-error' : ''}`} x={box.x} y="7" width={box.width} height="14" rx="1" role="button" tabIndex={active || !selected && mark === visible[0] ? 0 : -1} aria-label={`${mark.record.memberName} · ${c[mark.kind]} · ${processRecordTitle(mark.record)}`} aria-pressed={active} onFocus={() => setHover({ id: mark.record.id, fraction: Math.min(1, box.x / 1000) })} onBlur={() => setHover(null)} onPointerEnter={event => setHover({ id: mark.record.id, fraction: fractionAt(event.clientX) })} onClick={event => { const suppress = suppressClick.current && event.detail > 0; suppressClick.current = false; if (!suppress) { if (event.detail > 0) pickAt(mark.record, fractionAt(event.clientX)); else pick(mark.record); } }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); pick(mark.record); } }}><title>{`${mark.record.memberName} · ${processRecordTitle(mark.record)}${mark.interval ? `\n${time(mark.interval[0])}${mark.interval[1] > mark.interval[0] ? ` → ${time(mark.interval[1])}` : ` · ${c.noDuration}`}` : `\n${c.noDuration}`}`}</title></rect>;
        })}
      </svg>
      {!marks.length && <span className="task-timeline-empty">{records.length ? c.noTime : c.empty}</span>}
    </div>
    {choices && <div ref={choicePanel} role="dialog" aria-label={c.choices} className="task-timeline-choices" style={{ left: `clamp(var(--space-2), ${choices.fraction * 100}%, max(var(--space-2), calc(100% - min(25rem, 90%) - var(--space-2))))` }} onKeyDown={event => { if (event.key === 'Escape') { setChoices(null); track.current?.focus(); } }}>
      <header><strong>{c.choices} · {choices.ids.length}</strong><button type="button" aria-label={c.closeChoices} onClick={() => { setChoices(null); track.current?.focus(); }}>×</button></header>
      <div>{choices.ids.map(id => { const mark = marks.find(item => item.record.id === id); return mark ? <button key={id} type="button" data-record-choice={id} aria-pressed={id === selected} onClick={() => { pick(mark.record); track.current?.focus(); }}><span className={`task-timeline-kind ${mark.kind}`}>{c[mark.kind]}</span><span>{mark.record.memberName} · {processRecordTitle(mark.record)}</span></button> : null; })}</div>
    </div>}
    {tip && tooltip && !choices && <div role="tooltip" className="task-timeline-tooltip" style={{ left: `${Math.max(5, Math.min(70, tooltip.fraction * 100))}%` }}><strong>{tip.record.memberName} · {c[tip.kind]}</strong><span>{processRecordTitle(tip.record)}</span><code>{tip.interval ? `${time(tip.interval[0])}${tip.interval[1] > tip.interval[0] ? ` → ${time(tip.interval[1])}` : ` · ${c.noDuration}`}` : c.noDuration}</code></div>}
  </section>;
}
