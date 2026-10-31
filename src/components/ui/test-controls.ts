import { flushSync } from 'react-dom';
import { act } from 'react';
/** Exercise the real popup and option activation rather than a synthetic native change. */
export function chooseOption(trigger: Element, value: string): void {
  if (!(trigger instanceof HTMLElement)) throw new Error('Combobox trigger missing');
  act(() => flushSync(() => trigger.click()));
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(node => node.id.endsWith(`-${value}`));
  if (!option) throw new Error(`Option missing: ${value}`);
  act(() => flushSync(() => option.click()));
}
export function toggleDisclosure(container: Element): void {
  const trigger = container.querySelector<HTMLButtonElement>('.ui-accordion > button');
  if (!trigger) throw new Error('Disclosure trigger missing');
  act(() => flushSync(() => trigger.click()));
}

export function selectedValue(trigger: Element): string {
  return trigger.closest('.ui-choice')!.querySelector<HTMLInputElement>('input[type=hidden]')!.value;
}
export function optionsText(trigger: Element): string {
  if (!(trigger instanceof HTMLElement)) throw new Error('Combobox trigger missing');
  act(() => flushSync(() => trigger.click()));
  const content = document.querySelector('[role=listbox]')?.textContent ?? '';
  act(() => flushSync(() => trigger.click()));
  return content;
}
export function optionValues(trigger: Element): string[] {
  if (!(trigger instanceof HTMLElement)) throw new Error('Combobox trigger missing');
  act(() => flushSync(() => trigger.click()));
  const prefix=trigger.getAttribute('aria-controls')!.replace(/-options$/, '')+'-';
  const values=[...document.querySelectorAll<HTMLElement>('[role=option]')].map(node=>node.id.slice(prefix.length));
  act(() => flushSync(() => trigger.click()));
  return values;
}
