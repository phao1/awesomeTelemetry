import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
/** Only missing paths certify absence. Unreadable or slow sources stay unknown. */
export async function providerPathExists(path: string): Promise<boolean | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>(resolve => { timer=setTimeout(()=>resolve(null),1000);timer.unref(); });
  const probe = access(path,constants.R_OK).then(()=>true).catch((error:unknown)=>{
    const code=(error as NodeJS.ErrnoException).code;
    return code==='ENOENT'||code==='ENOTDIR'?false:null;
  });
  try { return await Promise.race([probe,deadline]); } finally { clearTimeout(timer); }
}
