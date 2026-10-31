import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Table } from './Table.js';

it('puts sort state on the column header and gives expansion its contextual row identity', () => {
  const container = document.createElement('div');document.body.appendChild(container);
  const root = createRoot(container);const expand = vi.fn();const sort = vi.fn();
  try {
    act(() => root.render(<Table columns={[{ key: 'name', label: 'Source', sortable: true, render: row => row.name }]} rows={[{ name: 'Specific source' }]}
      rowKey={row => row.name} sort={{ key: 'name', direction: 'desc' }} onSort={sort} expandedKey={null}
      onToggleExpand={expand} renderExpand={() => <tr><td>Details</td></tr>} expandLabel={row => 'Inspect ' + row.name} />));
    expect(container.querySelector('th[aria-sort="descending"]')?.textContent).toBe('Source');
    expect(container.querySelector('button[aria-sort]')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Inspect Specific source"]')!.click());
    expect(expand).toHaveBeenCalledWith('Specific source');
    act(() => container.querySelector<HTMLButtonElement>('thead button')!.click());expect(sort).toHaveBeenCalledWith('name');
  } finally { act(() => root.unmount());container.remove(); }
});
