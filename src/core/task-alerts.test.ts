import {expect,it} from 'vitest';
import type {TaskMetrics} from './task-types.js';
import {DEFAULT_ALERT_THRESHOLDS,formatTaskCosts,taskAlerts} from './task-alerts.js';
const metrics:TaskMetrics={durationMs:1000,toolCalls:3,errors:2,input:10,output:5,cacheRead:1,correctedTotal:16,costUsd:null,models:[],toolResults:2,toolFailures:1,contextPressurePct:81,costs:{known:2,total:2,amounts:[{currency:'USD',amount:1,source:'reported'},{currency:'CNY',amount:2,source:'estimated'}]}};
it('defaults off, uses strict boundaries and excludes pending calls from the failure denominator',()=>{
 expect(taskAlerts(metrics,DEFAULT_ALERT_THRESHOLDS)).toEqual([]);
 const limits={...DEFAULT_ALERT_THRESHOLDS,toolFailurePct:49,contextPressurePct:80,errors:2,costUSD:1,costCNY:1};
 expect(taskAlerts(metrics,limits)).toEqual([{rule:'toolFailurePct',threshold:49,actual:50},{rule:'contextPressurePct',threshold:80,actual:81},{rule:'costCNY',threshold:1,actual:2,currency:'CNY'}]);
 expect(taskAlerts({...metrics,toolResults:0,contextPressurePct:null,errors:null,costs:{...metrics.costs!,known:1}},limits)).toEqual([]);
});
it('shows separated currency, provenance and partial coverage; unknown never renders a free cost',()=>{
 expect(formatTaskCosts(metrics)).toBe('USD 1.0000 / CNY 2.0000 (estimated)');
 expect(formatTaskCosts({...metrics,costs:{...metrics.costs!,known:1}},true)).toContain('部分（1/2 成员）');
 expect(formatTaskCosts({...metrics,costs:{amounts:[],known:0,total:2}},true)).toBe('未知');
 const coverage={known:1,total:2,missing:[]};
 expect(taskAlerts({...metrics,coverage:{input:coverage,output:coverage,cacheRead:coverage,correctedTotal:coverage,models:coverage}}, {...DEFAULT_ALERT_THRESHOLDS,tokens:1})).toEqual([]);
});
