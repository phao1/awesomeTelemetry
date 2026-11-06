import { expect, it } from 'vitest';
import type { RsiEvaluation, RsiRun } from '../../src/core/rsi-types.js';
import { finalRuns } from './verdict.js';
const at='2026-11-07T00:00:00.000Z';
const evaluation:RsiEvaluation={id:'evaluation',taskId:'task',iterationId:'iteration',commit:'a'.repeat(40),phase:'train',sourceCommit:null,ablationOf:null,state:'completed',repetitions:1,questionIds:['a','b'],passedCounts:[1],score:1,infraErrorRatio:0,sealedVerdict:null,locked:false,createdAt:at,updatedAt:at};
const run=(id:string,questionId:string,outcome:RsiRun['outcome'],attempt:0|1=0):RsiRun=>({id,taskId:'task',evaluationId:'evaluation',questionId,repetition:0,attempt,outcome,failureReason:outcome==='pass'?null:outcome==='fail'?'test_failed':'infrastructure',durationMs:1,proxyTokens:1,artifactPath:null,sessionPath:null,at});
it('selects only the infrastructure retry and never score-shops a normal failure',()=>{
 const rows=[run('a-first','a','infra_error'),run('a-retry','a','pass',1),run('b-first','b','fail'),run('b-extra','b','pass',1)];expect(finalRuns(evaluation,rows).map(r=>r.id)).toEqual(['a-retry','b-first']);expect(rows).toHaveLength(4);
});
it('keeps missing retry slots missing instead of treating infrastructure as success',()=>{expect(finalRuns(evaluation,[run('a','a','infra_error')])).toEqual([]);});
it('excludes another evaluation and never mutates its input',()=>{const rows=[run('a','a','pass'),{...run('other','b','pass'),evaluationId:'other'}],before=structuredClone(rows);expect(finalRuns(evaluation,rows).map(r=>r.id)).toEqual(['a']);expect(rows).toEqual(before);});
