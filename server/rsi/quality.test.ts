import { it,expect } from 'vitest';
import { measureQuality } from './quality.js';
it('counts changed lines and files, excludes headers, approximates added functions',()=>{
  expect(measureQuality('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n-old\n+function next() {}\n+const value=1')).toEqual({addedLines:2,deletedLines:1,changedLines:3,files:1,addedFunctions:1});
});
