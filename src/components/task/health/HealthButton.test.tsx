import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { HealthButton } from './HealthButton.js';
it('exposes the shared drawer state and bilingual entry label', () => {
  const host = document.createElement('div'), root = createRoot(host), onClick = vi.fn();
  try {
    act(() => root.render(<HealthButton locale="zh" open={false} onClick={onClick}/>));
    const button = host.querySelector('button')!; expect(button.textContent).toBe('健康监测'); expect(button.getAttribute('aria-expanded')).toBe('false');
    act(() => button.click()); expect(onClick).toHaveBeenCalledOnce();
    act(() => root.render(<HealthButton locale="en" open onClick={onClick}/>)); expect(button.textContent).toBe('Health monitoring'); expect(button.getAttribute('aria-expanded')).toBe('true'); expect(button.getAttribute('aria-controls')).toBe('task-health-drawer');
  } finally { act(() => root.unmount()); }
});
