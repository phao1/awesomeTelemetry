import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../../i18n.js';
import { fetchJson } from '../../api/client.js';
import { validateBenchmarkDemo, validateBenchmarkReport } from '../../core/benchmark-validation.js';
import type { BenchmarkDemoInput, BenchmarkReport } from '../../core/benchmark-types.js';

export function BenchmarkSetup({ locale, onReport }: { locale: Locale; onReport: (report: BenchmarkReport) => void }): React.JSX.Element {
  const text = (cn: string, en: string) => locale === 'zh' ? cn : en;
  const [input, setInput] = useState<BenchmarkDemoInput>({ name: 'Qoder / CodeArts 对照实验', repetitions: 3, variants: [{ product: 'Qoder GUI', model: '示例模型 A' }, { product: 'CodeArts GUI', model: '示例模型 A' }] });
  const [running, setRunning] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const request = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => () => { const owned = request.current; request.current = null; if (owned) { clearTimeout(owned.timer); owned.controller.abort(); } }, []);
  const stop = () => {
    const owned = request.current; request.current = null;
    if (owned) { clearTimeout(owned.timer); owned.controller.abort(); }
    setRunning(false); setMessage(''); setError(text('已停止等待并请求取消；已完成的本地记录可能保留。可修改配置后显式重跑。', 'Stopped waiting and requested cancellation; completed local records may remain. Rerun explicitly when ready.'));
  };
  const start = () => {
    if (request.current) return;
    let config: BenchmarkDemoInput;
    try { config = validateBenchmarkDemo(input); }
    catch { setError(text('请填写实验名、产品、模型，并选择 1–10 次重复。', 'Fill the name, products and models; choose 1–10 repetitions.')); return; }
    setError(''); setMessage(''); setRunning(true);
    const owned = { controller: new AbortController(), timer: setTimeout(() => { if (request.current !== owned) return; stop(); }, 65000) };
    request.current = owned;
    void fetchJson<unknown>('/benchmarks/demo', { method: 'POST', signal: owned.controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) })
      .then(value => {
        if (request.current !== owned) return;
        const report = validateBenchmarkReport(value);
        onReport(report); setMessage(text(`已完成 ${report.runs.length} 次示例运行，报告在下方。`, `Completed ${report.runs.length} example runs. Report is shown below.`));
      }).catch(() => {
        if (request.current === owned) setError(text('示例运行未完成。请确认本地服务已更新、Git 可用且没有其他示例正在运行。已完成记录可能保留，重试需再次点击。', 'Example did not complete. Check the updated local service, Git availability and other active examples. Completed records may remain; retry explicitly.'));
      }).finally(() => { if (request.current === owned) { clearTimeout(owned.timer); request.current = null; setRunning(false); } });
  };
  return <section className="benchmark-setup" aria-label={text('新建示例实验', 'New example experiment')}>
    <h2>{text('新建实验 · 跑通完整流程', 'New experiment · run the complete workflow')}</h2>
    <ol className="benchmark-steps"><li>{text('固定任务', 'Fix task')}</li><li>{text('配置组合', 'Configure variants')}</li><li>{text('执行与验收', 'Run and evaluate')}</li><li>{text('对比与定位', 'Compare and inspect')}</li></ol>
    <p>{text('示例任务：实现加法函数，使用 3 个固定用例独立验收。第 1、3…组写入正确实现，第 2、4…组故意保留缺陷，用于展示诊断。产品和模型是示例标签，不调用真实 GUI 或模型。', 'Example task: implement addition, independently checked by 3 fixed tests. Odd-numbered variants write a correct implementation; even-numbered variants intentionally retain defects to exercise diagnosis. Product/model names are labels; no real GUI or model is invoked.')}</p>
    <fieldset disabled={running}><legend>{text('实验设置', 'Experiment settings')}</legend><div className="benchmark-form-grid">
      <label>{text('实验名称', 'Experiment name')}<input value={input.name} maxLength={120} onChange={e => setInput({ ...input, name: e.target.value })}/></label>
      <label>{text('每组重复次数', 'Repetitions per variant')}<select value={input.repetitions} onChange={e => setInput({ ...input, repetitions: Number(e.target.value) })}>{[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
    </div>
    {input.variants.map((v, i) => <div className="benchmark-variant-form" key={i}>
      <strong>{text('组合', 'Variant')} {i + 1}</strong>
      <label>{text('产品', 'Product')} {i + 1}<input value={v.product} maxLength={120} onChange={e => setInput({ ...input, variants: input.variants.map((item, index) => index === i ? { ...item, product: e.target.value } : item) })}/></label>
      <label>{text('模型', 'Model')} {i + 1}<input value={v.model} maxLength={120} onChange={e => setInput({ ...input, variants: input.variants.map((item, index) => index === i ? { ...item, model: e.target.value } : item) })}/></label>
      <button className="btn" disabled={input.variants.length === 1} onClick={() => setInput({ ...input, variants: input.variants.filter((_, index) => i !== index) })}>{text('移除', 'Remove')}</button>
    </div>)}
    <button className="btn" disabled={input.variants.length >= 8} onClick={() => setInput({ ...input, variants: [...input.variants, { product: 'Qoder GUI', model: input.variants[0]?.model ?? '示例模型 A' }] })}>{text('添加工具 / 模型组合', 'Add tool / model variant')}</button>
    </fieldset>
    <div className="benchmark-run-action"><button className="btn" disabled={running} onClick={start}>{running ? text('正在执行示例…', 'Running example…') : text(`运行示例评测（${input.variants.length * input.repetitions} 次）`, `Run example benchmark (${input.variants.length * input.repetitions} trials)`)}</button>
      {running && <button className="btn" onClick={stop}>{text('取消', 'Cancel')}</button>}
      <span>{text('独立工作区 → 实际文件修改 → 独立验收 → 自动报告', 'Isolated workspaces → real file edits → independent tests → automatic report')}</span>
    </div>
    {running && <p role="status">{text('正在本地准备工作区、依次执行各组合并验收；不调用模型。完成后自动显示结果。', 'Preparing local workspaces, executing variants and running independent tests. No model calls. Results appear on completion.')}</p>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
