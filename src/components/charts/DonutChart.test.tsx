import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,expect,it,vi} from 'vitest';
import {DonutRing} from './DonutChart.js';

describe('DonutRing explicit interactive slice coverage',()=>{
  it('retains numeric cache geometry without offering a nonfunctional drill-down',()=>{
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const click=vi.fn();
    try {
      act(()=>root.render(<svg><DonutRing slices={[{label:'input',value:30},{label:'cache',value:10}]} cx={50} cy={50} r={40} thickness={10}
        interactiveLabels={['input']} onSliceClick={click}/></svg>));
      const circles=host.querySelectorAll('circle');expect(circles).toHaveLength(2);
      expect(circles[0]?.getAttribute('role')).toBe('button');expect(circles[1]?.getAttribute('role')).toBeNull();
      expect(circles[1]?.getAttribute('tabindex')).toBeNull();
      act(()=>circles[1]!.dispatchEvent(new MouseEvent('click',{bubbles:true})));expect(click).not.toHaveBeenCalled();
      act(()=>circles[0]!.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true})));expect(click).toHaveBeenCalledExactlyOnceWith('input');
    } finally {act(()=>root.unmount());host.remove();}
  });
});
