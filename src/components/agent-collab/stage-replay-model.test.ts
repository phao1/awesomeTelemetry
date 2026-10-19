import {describe,expect,it} from 'vitest';
import type {TeamActivitySlim} from '../../core/trace-types.js';
import {buildReplayStages} from './stage-replay-model.js';
export const event=(id:string,over:Partial<TeamActivitySlim>={}):TeamActivitySlim=>({id,runId:'r',agentId:'a',taskId:null,roundId:null,kind:'tool_call',status:'success',startedAt:'2026-08-17T00:00:00Z',endedAt:null,nativeSequence:1,sessionKey:'s',eventId:id,turnKey:'turn-'+id,messageId:null,artifactId:null,tokenUsage:null,costUsd:null,costSource:null,costCurrency:null,hasInput:false,hasOutput:false,hasRaw:false,evidenceIds:[id],orderConfidence:'native',...over});
describe('evidence stage projection',()=>{
 it('excludes foreign runs and deduplicates semantic source calls by exact evidence IDs',()=>{
  const a=event('tool',{evidenceIds:['native-p']});const control=event('report',{kind:'task_status',taskId:'t',evidenceIds:['native-p']});
  const result=buildReplayStages('r',[a,control,control,event('foreign',{runId:'other'})]);
  expect(result.timed).toHaveLength(1);expect(result.timed[0]!.phase).toBe('report');expect(result.timed[0]!.taskId).toBe('t');
 });
 it('groups work only by exact native turn, with actor/session/task scope; never by nearby time',()=>{
  const result=buildReplayStages('r',[event('one',{turnKey:'shared'}),event('two',{turnKey:'shared',kind:'round'}),event('three',{turnKey:'different'}),event('four',{turnKey:'shared',agentId:'b'})]);
  expect(result.timed).toHaveLength(3);expect(result.timed.find(stage=>stage.activities.some(activity=>activity.id==='one'))!.activities).toHaveLength(2);expect(result.timed.every(stage=>stage.taskId===null)).toBe(true);
 });
 it('keeps missing/invalid times outside the timed axis and marks tied times as ambiguous',()=>{
  const result=buildReplayStages('r',[event('a'),event('b'),event('c',{startedAt:null}),event('d',{startedAt:'invalid'})]);
  expect(result.timed).toHaveLength(2);expect(result.timed.every(stage=>stage.ambiguous)).toBe(true);expect(result.undated).toHaveLength(2);expect(result.undated.every(stage=>stage.time===null)).toBe(true);
 });
 it('does not use a snapshot final state to produce a historical outcome',()=>{
  const result=buildReplayStages('r',[event('one',{taskId:'completed-in-snapshot'})]);expect(result.timed[0]!.phase).toBe('execution');expect(result.timed[0]!.activities[0]!.status).toBe('success');
 });
});
