import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RSI_COPY, helpReasonText, reasonLabel } from './copy.js';
describe('RSI bilingual reason vocabulary',()=>{
  it('covers every authoritative hold/pause/outcome/finding/failure/calibration code',()=>{
    const contract=readFileSync('openspec/contracts/rsi.md','utf8'),block=contract.slice(contract.indexOf('### P5 authoritative runtime declarations'),contract.indexOf('### P5 host configuration'));
    const groups=['RsiHoldReason','RsiPauseReason','RsiOutcome','RsiFindingCategory','RsiCalibrationCategory'];
    const codes=groups.flatMap(group=>[...block.match(new RegExp(`export type ${group} = ([^;]+);`))![1]!.matchAll(/'([^']+)'/g)].map(m=>m[1]!));
    codes.push('test_failed','agent_timeout','agent_crashed','run_token_budget','infrastructure','l0_reject','l1_reject','gain_not_above_noise','sealed_regression','stable_regression');
    for(const code of codes){expect(Object.hasOwn(RSI_COPY,code),code).toBe(true);expect(reasonLabel(code,'zh'),code).not.toBe(reasonLabel(code,'en'));}
  });
  it('covers all documented HTTP error codes and ledger issue codes',()=>{
    const api=readFileSync('openspec/contracts/api.md','utf8').split('## RSI queue-only API')[1]!,ledger=readFileSync('server/rsi/ledger.ts','utf8').match(/export type LedgerIssueCode = ([\s\S]+?);/)![1]!;
    const codes=[...api.matchAll(/\| (RSI_[A-Z_]+|INTERNAL_ERROR) \|/g)].map(m=>m[1]!);codes.push(...[...ledger.matchAll(/'([^']+)'/g)].map(m=>m[1]!));for(const code of codes)expect(Object.hasOwn(RSI_COPY,code),code).toBe(true);
  });
  it('has nonempty separate Chinese and English labels for every code, with a safe unknown fallback',()=>{
    for(const [code,labels] of Object.entries(RSI_COPY)){expect(labels[0].trim(),code).not.toBe('');expect(labels[1].trim(),code).not.toBe('');}
    expect(reasonLabel('future_private_code','zh')).toBe('未知原因');expect(reasonLabel('future_private_code','en')).toBe('Unknown reason');
  });
});

describe('help reasons', () => {
  it('translates the platform\'s own requests and leaves an optimizer\'s words alone', () => {
    expect(helpReasonText('Three consecutive optimizer sessions without a submission', 'zh')).toBe('优化者连续 3 轮没有提交');
    expect(helpReasonText('Three consecutive optimizer sessions without a submission', 'en')).toBe('Three consecutive optimizer sessions without a submission');
    expect(helpReasonText('我卡在依赖上了', 'zh')).toBe('我卡在依赖上了');
  });
});
