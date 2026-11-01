/** Sourced context metadata retained from the Anthropic model table cached 2026-06-24. */
const CONTEXT_WINDOWS: Record<string,number> = {
  'claude-fable-5':1000000,'claude-mythos-5':1000000,'claude-opus-5':1000000,
  'claude-opus-4-8':1000000,'claude-opus-4-7':1000000,'claude-opus-4-6':1000000,
  'claude-sonnet-5':1000000,'claude-sonnet-4-6':1000000,'claude-haiku-4-5':200000,
};
export function normalizeModelId(model: string): string {
  const lowered = model.trim().toLowerCase();
  const noVendor = lowered.replace(/^(anthropic|us|eu|apac)\./, '');
  // 去掉 [1m] 之类的窗口标注和 8 位日期后缀
  return noVendor.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '').trim();
}

export function lookupContextWindow(model: string | null | undefined): number | null {
  const key=model ? normalizeModelId(model) : '';
  return Object.hasOwn(CONTEXT_WINDOWS,key) ? CONTEXT_WINDOWS[key]! : null;
}
