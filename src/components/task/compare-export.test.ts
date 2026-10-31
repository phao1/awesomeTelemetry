import {expect,it} from 'vitest';
import {comparisonExportLines} from './compare-export.js';
import {exportTaskComparison,comparisonRow} from '../../core/task-comparison.js';
import type {TaskComparisonSnapshot,TaskSummary} from '../../core/task-types.js';
import {makeResult,makeEvent} from '../compare-test-fixtures.js';
const coverage={known:1,total:1,missing:[]};
const task:TaskSummary={id:'collected:a',title:'REAL <script>task</script>',origin:'collected',provenanceKnown:true,rootSessionKey:'a',runId:null,provider:'codex',startedAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z',recordedStatus:'success',memberCount:1,eventCount:1,loadedMemberCount:1,metrics:{durationMs:100,toolCalls:1,errors:0,input:1234,output:40,cacheRead:20,correctedTotal:1294,promptInput:40,cacheHitRate:0.5,models:['model'],coverage:{input:coverage,output:coverage,cacheRead:coverage,correctedTotal:coverage,promptInput:coverage,cacheHitRate:coverage,models:coverage}}};
it('exports visible token/cache medians and retained process/tool evidence in the selected locale as inert text',()=>{
 const snapshot:TaskComparisonSnapshot={a:[task],b:[{...task,id:'collected:b'}]},process=makeResult();process.left.events=[makeEvent({kind:'tool',tool:'read',title:'REAL <script>tool</script>',durationMs:100,status:'error'})];process.left.eventTotal=1;
 for(const locale of ['zh','en'] as const)for(const format of ['md','html'] as const){const lines=comparisonExportLines(snapshot,locale,process,null);expect(lines.join(' ')).toContain('1.2K');expect(lines.join(' ')).toContain('50.0%');expect(lines.join(' ')).toContain('read');expect(lines.join(' ')).toContain(locale==='zh'?'缓存写: —':'Cache write: —');
 const output=exportTaskComparison([comparisonRow('duration',locale==='zh'?'时长':'Duration','ms',[100],[80])],null,[],locale,format,'#/compare',snapshot,lines);expect(output).toContain(locale==='zh'?'Token 构成':'Token composition');expect(output).not.toContain('<script>');expect(output).not.toMatch(/cost|currency|[$¥￥€£]/i);
 }
});
