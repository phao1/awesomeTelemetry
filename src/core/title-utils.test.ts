import { describe, expect, it } from 'vitest';

import {
  cleanTitleText,
  extractSlashCommand,
  extractTitleFromUserText,
  isInjectedFirstLine,
} from './title-utils.js';

describe('标题净化（侧栏可区分性）', () => {
  it('剥掉 <command-name> 包装', () => {
    expect(cleanTitleText('<command-name>/goal</command-name>')).toBe('/goal');
  });

  it('markdown 链接只保留可读文字', () => {
    expect(cleanTitleText('根据 [v2.md](tempspec0806/v2.md) 继续优化')).toBe(
      '根据 v2.md 继续优化',
    );
  });

  it('剥掉行首 slash 命令，让标题从真正有差异的部分开始', () => {
    // 实测三条会话截断后都是 "/goal 根据 …"，完全同形
    expect(cleanTitleText('/goal 根据 [v2.md](a/v2.md) 继续优化')).toBe('根据 v2.md 继续优化');
    expect(cleanTitleText('/goal 整理下项目的文件和目录')).toBe('整理下项目的文件和目录');
  });

  it('slash 命令单独提取，供 UI 渲染成标签', () => {
    expect(extractSlashCommand('/goal 做点什么')).toBe('/goal');
    expect(extractSlashCommand('<command-name>/goal</command-name>')).toBe('/goal');
    expect(extractSlashCommand('普通的一句话')).toBeNull();
  });

  it('整行只有包装时保留原文，不产出空标题', () => {
    expect(extractTitleFromUserText('<command-name></command-name>')).toBe(
      '<command-name></command-name>',
    );
  });

  it('注入内容仍然返回 null（不得被净化绕过）', () => {
    expect(isInjectedFirstLine('<system-reminder>')).toBe(true);
    expect(extractTitleFromUserText('<system-reminder>\nfoo')).toBeNull();
  });

  it('净化后仍按 120 字符截断', () => {
    expect(extractTitleFromUserText('z'.repeat(200))?.length).toBe(120);
  });
});
