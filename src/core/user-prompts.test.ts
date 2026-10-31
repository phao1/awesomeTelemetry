import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyUserPrompt, KNOWN_PLATFORM_USER_TAGS } from './user-prompts.js';
import { isGenuineUserRecord, isSystemRecord, isUserReplyRecord } from './system-records.js';
import { D01F_USER_MESSAGES, D01F_QUESTION_POSITIONS } from './__fixtures__/user-prompts.js';
const event=(title:string)=>({kind:'user_prompt' as const,title,hasInput:true,hasOutput:false});
it.each(KNOWN_PLATFORM_USER_TAGS)('classifies the documented %s envelope and its retained first-line prefix',tag=>{
  const expected=tag==='send_user_message_question_reply'?'reply':'injection';
  expect(classifyUserPrompt(`<${tag} source="goal">payload</${tag}>`)).toBe(expected);
  expect(classifyUserPrompt(`<${tag} source="goal">`,true)).toBe(expected);
  expect(isGenuineUserRecord(event(`<${tag}>payload</${tag}>`))).toBe(false);
  expect(isUserReplyRecord(event(`<${tag}>payload</${tag}>`))).toBe(expected==='reply');
});
it.each([
  '<brand_new_platform_tag>anything</brand_new_platform_tag>',
  ' \n <unknown id="x > y"><nested/></unknown> \n <another value=\'a>b\'/> \t',
  '<outer><outer>nested</outer><unclosed_payload_code></outer>',
  '<codex_internal_context source="goal">Continue goal</codex_internal_context>',
  '# AGENTS.md instructions for /Users/example\nRules',
  '# Skills\nSystem instructions', '# System instructions\nRules', '# Developer instructions\nRules',
  'intent. When a skill is relevant, you must invoke the Skill tool IMMEDIATELY as your first action.\n</system-reminder>\n\nSearch…',
])('excludes platform/system/skill injections: %s',text=>{
  expect(classifyUserPrompt(text)).toBe('injection');expect(isGenuineUserRecord(event(text.split('\n').find(line=>line.trim())?.trim()??''))).toBe(false);
});
it.each([
  '# Skills marketplace needs a search box', '# System architecture question',
  '请解释 <environment_context>...</environment_context> 这个字段',
  '修复这里的问题 <codex_internal_context source="goal">example</codex_internal_context>',
  '普通文字开头\n<system-reminder>an example</system-reminder>',
  'Explain <system-reminder>without closing',
  'Why does </system-reminder> appear in logs?',
  'Please review # AGENTS.md instructions for my repo',
  '<example>data</example> then fix the bug',
  '<a/> trailing ordinary text', '<x>one</x> prose <y>two</y>',
  'Show me a <send_user_message_question_reply> tag example',
])('protects genuine prose and text outside tag blocks: %s',text=>{
  expect(classifyUserPrompt(text)).toBe('question');expect(isGenuineUserRecord(event(text))).toBe(true);expect(isSystemRecord(event(text))).toBe(false);
});
it('recognizes only an outer reply wrapper as answer input, without hiding it as system',()=>{
  const text='<context/> <send_user_message_question_reply>yes</send_user_message_question_reply> <next/>';
  expect(classifyUserPrompt(text)).toBe('reply');expect(isUserReplyRecord(event(text))).toBe(true);expect(isSystemRecord(event(text))).toBe(false);
  expect(classifyUserPrompt('<outer><send_user_message_question_reply>text</send_user_message_question_reply></outer>')).toBe('injection');
});
it('does not treat unfinished full messages as complete blocks; supports explicit retained prefixes',()=>{
  expect(classifyUserPrompt('<unknown>incomplete')).toBe('question');expect(classifyUserPrompt('<unknown>incomplete',true)).toBe('injection');
  expect(classifyUserPrompt('<another_platform source="unfinished',true)).toBe('injection');
  expect(classifyUserPrompt('<send_user_message_question_reply source="unfinished',true)).toBe('reply');
});
it('has a documentation/test catalogue and reproduces exactly eight d01f questions',()=>{
  for(const file of ['openspec/contracts/task-health.md','openspec/contracts/task-requests.md','docs/task-health/requests.md']){
    const text=readFileSync(file,'utf8');for(const tag of KNOWN_PLATFORM_USER_TAGS)expect(text,file+':'+tag).toContain('`'+tag+'`');
  }
  expect(D01F_USER_MESSAGES.flatMap((text,i)=>isGenuineUserRecord(event(text.split('\n')[0]!))?[i+1]:[])).toEqual(D01F_QUESTION_POSITIONS);
});
