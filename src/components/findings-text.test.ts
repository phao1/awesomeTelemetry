import { describe, expect, it } from 'vitest';

import type { Finding } from '../core/session-findings.js';
import { formatFindingDetail, formatFindingTitle } from './findings-text.js';

function finding(partial: Partial<Finding>): Finding {
  return {
    id: 'rule-1',
    severity: 'warning',
    category: 'time',
    kind: 'phaseDominant',
    data: { phase: 'debug', pct: '80', durMs: 480000, totalMs: 600000, count: 12 },
    evidence: { eventIds: [] },
    ...partial,
  };
}

describe('formatFinding', () => {
  it('标题是判断句且含数字', () => {
    const title = formatFindingTitle(finding({}), 'zh');
    expect(title).toContain('调试');
    expect(title).toContain('80%');
    expect(title).toContain('占');
  });

  it('详情含时长换算', () => {
    const detail = formatFindingDetail(finding({}), 'zh');
    expect(detail).toContain('8m');
    expect(detail).toContain('12');
  });

  it('repairLoop 文案', () => {
    const f = finding({ kind: 'repairLoop', data: { rounds: 3, groups: 2, steps: 9 } });
    expect(formatFindingTitle(f, 'zh')).toContain('3');
  });

  it('盲写文件文案', () => {
    const f = finding({
      kind: 'blindWrite',
      data: { count: 3, files: ['jwt.ts', 'x.ts', 'y.ts'] },
    });
    expect(formatFindingTitle(f, 'zh')).toContain('3');
    expect(formatFindingDetail(f, 'zh')).toContain('jwt.ts');
  });
});
