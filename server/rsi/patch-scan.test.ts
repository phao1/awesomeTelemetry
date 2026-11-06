import { expect, it } from 'vitest';
import { scanTargetPatch } from './patch-scan.js';
const patch = (line: string, file = 'logic.py') => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+${line}\n`;
it.each(['process.exit(0)', 'process["exit"](0)', 'os._exit(0)', 'sys.exit(0)', 'readFile("hidden_tests/a.py")', 'assert.equal = () => true', 'assert["equal"] = () => true', 'unittest = fake', 'unittest.TestCase.assertEqual = lambda: True', 'setattr(unittest, "TestResult", Fake)', 'Object.defineProperty(assert, "equal", {})', 'sys.modules["unittest"] = fake', 'open("/usr/lib/unittest/result.py", "w")'])('flags target patch framework interference: %s', text => {
  expect(scanTargetPatch(patch(text))).toEqual([{ category: 'suspicious', file: 'logic.py', line: 1, evidence: text }]);
});
it('flags framework file changes and preserves the exercise patch location', () => {
  expect(scanTargetPatch(patch('noop()', 'unittest/result.py'))).toEqual([{ category: 'suspicious', file: 'unittest/result.py', line: 0, evidence: 'Patch changes a test-framework implementation' }]);
});
it('does not flag an ordinary fix or removed suspicious content', () => {
  expect(scanTargetPatch(patch('return items.slice(offset, offset + limit);'))).toEqual([]);
  expect(scanTargetPatch(patch('return 1').replace('-old', '-sys.exit(0)'))).toEqual([]);
});
