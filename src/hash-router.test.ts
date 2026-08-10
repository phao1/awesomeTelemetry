import { describe, expect, it } from 'vitest';

import { parseHash, serializeHash } from './hash-router.js';

describe('REQ-024 hash 路由', () => {
  it('序列化/解析往返：sessions 带 key/phase/provider', () => {
    const hash = serializeHash({
      view: 'session',
      key: 'codex-abc',
      phase: ['implement', 'debug'],
      provider: ['codex'],
    });
    expect(hash).toBe('#/session?key=codex-abc&phase=implement%2Cdebug&provider=codex');
    expect(parseHash(hash)).toEqual({
      view: 'session',
      key: 'codex-abc',
      phase: ['implement', 'debug'],
      provider: ['codex'],
    });
  });

  it('compare left/right 往返', () => {
    const hash = serializeHash({ view: 'compare', left: 'a-1', right: 'b-2' });
    expect(hash).toBe('#/compare?left=a-1&right=b-2');
    expect(parseHash(hash)).toEqual({ view: 'compare', left: 'a-1', right: 'b-2' });
  });

  it('脏 hash 回落：非法视图与乱码返回 null', () => {
    expect(parseHash('#/unknown?x=1')).toBeNull();
    // 乱码值不抛错（URLSearchParams 不校验 %zz）；App 侧对 phase 再做白名单校验
    expect(() => parseHash('#/session?phase=%zz')).not.toThrow();
    expect(parseHash('#/session?phase=%zz')).toEqual({ view: 'session', phase: ['%zz'] });
  });

  it('空参数省略', () => {
    expect(serializeHash({ view: 'agent' })).toBe('#/agent');
    expect(parseHash('#/session')).toEqual({ view: 'session' });
  });

  it('会话列表过滤 q/time 往返', () => {
    const hash = serializeHash({
      view: 'session',
      q: 'codearts-87fa',
      time: '7d',
    });
    expect(hash).toBe('#/session?q=codearts-87fa&time=7d');
    expect(parseHash(hash)).toEqual({
      view: 'session',
      q: 'codearts-87fa',
      time: '7d',
    });
  });

  it('非法 time 回落缺省；空 q 省略', () => {
    expect(parseHash('#/session?time=1y&q=')).toEqual({ view: 'session' });
    expect(serializeHash({ view: 'session', time: 'today' })).toBe('#/session?time=today');
  });

  it('trajectory turn/ribbon 往返（add-trajectory-inspector D18）', () => {
    const hash = serializeHash({
      view: 'session',
      key: 'codex-abc',
      turn: 3,
      ribbon: 'token',
    });
    expect(hash).toBe('#/session?key=codex-abc&turn=3&ribbon=token');
    expect(parseHash(hash)).toEqual({
      view: 'session',
      key: 'codex-abc',
      turn: 3,
      ribbon: 'token',
    });
  });

  it('turn/ribbon 非法值整体丢弃，不抛错（D18）', () => {
    expect(parseHash('#/session?turn=-1&ribbon=grid')).toEqual({ view: 'session' });
    expect(parseHash('#/session?turn=abc')).toEqual({ view: 'session' });
    expect(parseHash('#/session?turn=7')).toEqual({ view: 'session', turn: 7 });
    expect(parseHash('#/session?ribbon=token')).toEqual({ view: 'session', ribbon: 'token' });
  });

  it('被删除甘特的 layout 键被忽略（D18：旧键不回写、不生效）', () => {
    expect(parseHash('#/session?layout=sequence')).toEqual({ view: 'session' });
    expect(parseHash('#/session?layout=time&ribbon=time')).toEqual({ view: 'session', ribbon: 'time' });
    // 序列化不再输出 layout
    expect(serializeHash({ view: 'session' })).toBe('#/session');
  });
});
