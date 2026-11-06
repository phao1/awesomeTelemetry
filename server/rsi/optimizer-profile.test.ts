import { describe,it,expect } from 'vitest';
import { resolve } from 'node:path';
import { readOptimizerProfile, validateOptimizerProfile, renderOptimizerRun } from './optimizer-profile.js';
import { handoffPrompt } from './handoff-prompt.js';
describe('RSI-014 optimizer profiles',()=>{
  it.each(['opencode-deepseek','codex','claude-code','scripted'])('validates bundled %s without Docker',async id=>{expect((await readOptimizerProfile(resolve('rsi-agents/optimizers',id,'profile.json'))).profile.id).toBe(id);});
  it('rejects unknown fields, wildcards, credentials and reserved env',async()=>{
    const {profile}=await readOptimizerProfile(resolve('rsi-agents/optimizers/scripted/profile.json'));
    expect(()=>validateOptimizerProfile({...profile,extra:1})).toThrow();
    expect(()=>validateOptimizerProfile({...profile,egress:{kind:'vendor-allowlist',domains:['*.example.com']}})).toThrow();
    expect(()=>validateOptimizerProfile({...profile,run:{...profile.run,env:{RSI_API_BASE:'evil'}}})).toThrow();
    expect(()=>validateOptimizerProfile({...profile,run:{...profile.run,env:{API_KEY:'literal'}}})).toThrow();
  });
  it('substitutes prompt once literally and handoff accepts no monitor prose',async()=>{
    const {profile}=await readOptimizerProfile(resolve('rsi-agents/optimizers/codex/profile.json'));
    const prompt='{{model}} $(touch /tmp/forbidden)';expect(renderOptimizerRun(profile,prompt,'model','secret').argv.at(-1)).toBe(prompt);
    expect(handoffPrompt()).toContain('ONE hypothesis');expect(handoffPrompt()).toContain('stuck');expect(handoffPrompt()).toContain('$RSI_AGENT_TOKEN');expect(handoffPrompt()).not.toContain('secret-review-marker');
  });
});
