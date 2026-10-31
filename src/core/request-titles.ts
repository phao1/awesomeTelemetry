import { redactHealthText } from './task-health/render.js';

/** Presentation only: never used by genuine-input classification or boundaries. */
export const REQUEST_TITLE_VERSION = 1;
export function isAttachedFilesPrompt(text: string): boolean {
  return /^\s*#\s+Files mentioned by the user:\s*(?:\r?\n|$)/i.test(text);
}
/** Iterate lines without duplicating a potentially large attached-file body. */
function* lines(text: string): Generator<string> {
  let start=0;
  while(start<text.length){const end=text.indexOf('\n',start);if(end<0){yield text.slice(start).replace(/\r$/,'');return;}yield text.slice(start,end).replace(/\r$/,'');start=end+1;}
}
export function extractRequestTitle(text: string): string {
  const finish=(line:string)=>redactHealthText(line).slice(0,200);
  if(!isAttachedFilesPrompt(text))return finish(text.split(/\r?\n/,1)[0]??'');
  let fence: {char:string;length:number}|null=null, inRequest=false;
  const files=new Set<string>();
  for(const line of lines(text)){
    const trimmed=line.trim();
    const marker=/^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if(fence){if(marker&&marker[1]![0]===fence.char&&marker[1]!.length>=fence.length&&!marker[2]!.trim())fence=null;continue;}
    if(marker){fence={char:marker[1]![0]!,length:marker[1]!.length};continue;}
    const heading=/^##\s+(.+?)\s*$/.exec(trimmed);
    if(heading){
      const name=heading[1]!;
      const request=/^My request(?: for Codex)?:\s*(.*)$/i.exec(name);
      if(request){if(request[1]!.trim())return finish(request[1]!.trim());inRequest=true;continue;}
      if(inRequest)break;
      // Codex file sections: "## file.ts: /path/file.ts" or "## /path/file.ts".
      if(/^[^:]+:\s*\S/.test(name)||/^(?:[A-Za-z]:[\\/]|[./~\\])/.test(name)||/^[^/\\]+\.[A-Za-z0-9_-]+$/.test(name)||/^\[[^\]]+\]\(/.test(name))files.add(name);
      continue;
    }
    if(inRequest&&trimmed)return finish(trimmed);
  }
  return files.size?`附带文件的提问（${files.size} 个文件）`:'附带文件的提问';
}
