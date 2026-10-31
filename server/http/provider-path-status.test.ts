import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { providerPathExists } from './provider-path-status.js';
it('reports actual directory/file access and distinguishes a missing path',async()=>{const root=await mkdtemp(join(tmpdir(),'provider-path-'));try{await writeFile(join(root,'source.sqlite'),'source');expect(await providerPathExists(root)).toBe(true);expect(await providerPathExists(join(root,'source.sqlite'))).toBe(true);expect(await providerPathExists(join(root,'missing'))).toBe(false);expect(await providerPathExists(join(root,'source.sqlite','child'))).toBe(false);}finally{await rm(root,{recursive:true,force:true});}});
it('keeps unexpected filesystem errors unknown instead of reporting a missing directory',async()=>{expect(await providerPathExists('a'.repeat(5000))).toBe(null);});
