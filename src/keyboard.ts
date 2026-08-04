/**
 * REQ-008（design D1/D2）：单一全局 keydown 监听 + 映射表。
 * - 输入框聚焦或 isComposing 时只放行 Esc（中文输入法安全）
 * - Esc 按浮层层级出栈关闭（palette > modal > drawer > popover）
 */

export interface ShortcutSpec {
  key: string;
  ctrlOrMeta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

type ShortcutHandler = () => void;

interface Registration {
  spec: ShortcutSpec;
  handler: ShortcutHandler;
}

const registry = new Map<string, Registration>();

/** 浮层栈：Esc 只关栈顶（D2）。 */
const overlayStack: Array<() => void> = [];
let escapeFallback: (() => void) | null = null;

function modKey(spec: ShortcutSpec): string {
  return [
    spec.ctrlOrMeta === true ? 'M' : '',
    spec.shift === true ? 'S' : '',
    spec.alt === true ? 'A' : '',
    spec.key.toLowerCase(),
  ].join(':');
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLElement) {
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }
  return false;
}

export function registerShortcut(spec: ShortcutSpec, handler: ShortcutHandler): () => void {
  const key = modKey(spec);
  registry.set(key, { spec, handler });
  return () => {
    if (registry.get(key)?.handler === handler) {
      registry.delete(key);
    }
  };
}

export function pushOverlay(close: () => void): () => void {
  overlayStack.push(close);
  return () => {
    const index = overlayStack.indexOf(close);
    if (index >= 0) {
      overlayStack.splice(index, 1);
    }
  };
}

export function closeTopOverlay(): boolean {
  const index = overlayStack.length - 1;
  const close = overlayStack[index];
  if (close === undefined) {
    return false;
  }
  overlayStack.splice(index, 1);
  close();
  return true;
}

export function overlayCount(): number {
  return overlayStack.length;
}

let installed = false;

/** 单例安装：整个应用只挂一个 keydown 监听（D1）。 */
export function installKeyboardShortcuts(): void {
  if (installed) {
    return;
  }
  installed = true;
  document.addEventListener('keydown', (event) => {
    if (event.isComposing) {
      return;
    }
    if (event.key === 'Escape') {
      // 输入框聚焦时 Esc 也放行（关闭浮层/清除选择）
      if (closeTopOverlay()) {
        event.preventDefault();
      } else if (escapeFallback !== null) {
        escapeFallback();
        event.preventDefault();
      }
      return;
    }
    if (isEditableTarget(event.target)) {
      return; // 1.2：输入框聚焦时只放行 Esc
    }
    const spec: ShortcutSpec = {
      key: event.key,
      ctrlOrMeta: event.metaKey || event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
    };
    const registration = registry.get(modKey(spec));
    if (registration === undefined) {
      return;
    }
    event.preventDefault();
    registration.handler();
  });
}

/** Esc 无浮层时的兜底（如清除选择）。 */
export function setEscapeFallback(handler: (() => void) | null): void {
  escapeFallback = handler;
}
