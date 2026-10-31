import { useRef, useState, type ReactNode } from 'react';
import { Button } from './Button.js';
import { IconUpload } from '../icons/index.js';
import '../../styles/components/page-controls.css';
export function Dropzone({ label, description, accept, disabled, onFile, buttonLabel=label, actions, icon, primary=false }: { label: string; buttonLabel?:string; actions?:ReactNode; icon?:ReactNode; primary?:boolean; description?: string; accept: string; disabled?: boolean; onFile: (file: File | undefined) => void }): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null), [dragging, setDragging] = useState(false);
  return <div className="ui-dropzone" data-dragging={dragging} onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!disabled) onFile(event.dataTransfer.files[0]); }}>
    {icon??<IconUpload />}<strong>{label}</strong>{description && <p>{description}</p>}
    <input ref={ref} type="file" hidden accept={accept} disabled={disabled} aria-label={label} onChange={event => { onFile(event.target.files?.[0]); event.target.value = ''; }} />
    <div className="ui-dropzone-actions"><Button variant={primary?'primary':'secondary'} disabled={disabled} onClick={() => ref.current?.click()}>{buttonLabel}</Button>{actions}</div>
  </div>;
}
