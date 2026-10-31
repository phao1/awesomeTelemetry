import { useUiLocale } from './Locale.js';
import '../../styles/components/page-controls.css';
import { Children, isValidElement, useId, useRef, useEffect, useState, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Select, type SelectOption } from './Select.js';
import { Accordion } from './Display.js';
import { Button } from './Button.js';
import { IconUpload } from '../icons/index.js';

function text(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child)).join('');
}
/** Declarative option content, rendered through the searchable library selector. */
export function OptionSelect({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  const id = useId(), ref=useRef<HTMLSpanElement>(null), [label,setLabel]=useState('Select');
  useEffect(()=>{const parent=ref.current?.closest('label');if(!parent)return;const clone=parent.cloneNode(true) as HTMLElement;clone.querySelectorAll('.ui-option-select').forEach(node=>node.remove());const value=clone.textContent?.trim();if(value)setLabel(value);},[children]);
  const options: SelectOption[] = Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return [];
    return [{ value: String(child.props.value ?? text(child.props.children)), label: text(child.props.children), disabled: child.props.disabled }];
  });
  return <span className="ui-option-select" ref={ref}><Select {...props} aria-label={props['aria-label']??label} size="md" id={props.id ?? id} options={options} /></span>;
}
/** Named disclosure keeps expanded content lazy and keyboard accessible. */
export function Disclosure({ title, children, className, open, onOpenChange, ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & { title: ReactNode; children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }): React.JSX.Element {
  return <div {...props} className={className}><Accordion keepMounted title={title} defaultOpen={open} open={onOpenChange ? open : undefined} onOpenChange={onOpenChange}>{children}</Accordion></div>;
}
/** Browser file input stays hidden; a normal library button owns activation. */
export function FilePicker(props: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null), zh=useUiLocale()==='zh';
  return <span className="ui-file-picker"><input {...props} ref={ref} type="file" hidden /><Button icon={<IconUpload />} disabled={props.disabled} onClick={() => ref.current?.click()}>{props['aria-label'] ?? (zh?'选择文件':'Choose file')}</Button></span>;
}
