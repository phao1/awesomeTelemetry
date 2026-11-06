"""Trusted unittest runner. Targets are repository-relative files, never shell text."""
import contextlib
import importlib.util
import io
import json
import os
import sys
import unittest


def main():
    suite = unittest.TestSuite()
    sys.path.insert(0, os.getcwd())
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        for index, target in enumerate(sys.argv[1:]):
            spec = importlib.util.spec_from_file_location("rsi_hidden_" + str(index), target)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
        result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)
    print(json.dumps({"reporter": "rsi-unittest-v1", "tests": result.testsRun,
        "passed": result.testsRun - len(result.failures) - len(result.errors) - len(result.skipped)
            - len(result.expectedFailures) - len(result.unexpectedSuccesses),
        "failed": len(result.failures) + len(result.errors) + len(result.unexpectedSuccesses),
        "skipped": len(result.skipped) + len(result.expectedFailures), "cancelled": 0, "todo": 0}))
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
