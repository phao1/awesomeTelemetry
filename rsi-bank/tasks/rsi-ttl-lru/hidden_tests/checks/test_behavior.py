import copy
import json
import unittest
from logic import evaluate


class Behavior(unittest.TestCase):
    def test_ttl_lru_scenario_01(self):
        args = json.loads('[2, [{"type": "put", "key": "a", "value": "wisteria-cache", "ttl": 10, "now": 0}, {"type": "put", "key": "b", "value": "B", "ttl": 10, "now": 0}, {"type": "get", "key": "a", "now": 0}, {"type": "put", "key": "c", "value": "C", "ttl": 10, "now": 0}, {"type": "get", "key": "b", "now": 0}, {"type": "get", "key": "a", "now": 0}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["wisteria-cache", null, "wisteria-cache"]'), "regression-c6b2e84fd11f761d")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_ttl_lru_scenario_02(self):
        args = json.loads('[1, [{"type": "put", "key": "a", "value": "A", "ttl": 2, "now": 0}, {"type": "get", "key": "a", "now": 2}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[null]'), "regression-c6b2e84fd11f761d")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_ttl_lru_scenario_03(self):
        args = json.loads('[0, [{"type": "put", "key": "a", "value": "A", "ttl": 10, "now": 0}, {"type": "get", "key": "a", "now": 0}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[null]'), "regression-c6b2e84fd11f761d")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_ttl_lru_scenario_04(self):
        args = json.loads('[2, [{"type": "put", "key": "a", "value": "A", "ttl": 10, "now": 0}, {"type": "put", "key": "b", "value": "B", "ttl": 10, "now": 0}, {"type": "put", "key": "a", "value": "new", "ttl": 10, "now": 0}, {"type": "put", "key": "c", "value": "C", "ttl": 10, "now": 0}, {"type": "get", "key": "a", "now": 0}, {"type": "get", "key": "b", "now": 0}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["new", null]'), "regression-c6b2e84fd11f761d")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_ttl_lru_scenario_05(self):
        args = json.loads('[1, [{"type": "put", "key": "a", "value": "A", "ttl": 0, "now": 0}, {"type": "get", "key": "a", "now": 0}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[null]'), "regression-c6b2e84fd11f761d")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_ttl_lru_scenario_06(self):
        args = json.loads('[1, [{"type": "put", "key": "a", "value": "A", "ttl": 3, "now": 0}, {"type": "get", "key": "a", "now": 2}, {"type": "get", "key": "a", "now": 3}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["A", null]'), "regression-c6b2e84fd11f761d")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_ttl_lru_scenario_07(self):
        args = json.loads('[2, [{"type": "put", "key": "a", "value": false, "ttl": 10, "now": 0}, {"type": "get", "key": "a", "now": 0}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[false]'), "regression-c6b2e84fd11f761d")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_ttl_lru_scenario_08(self):
        args = json.loads('[1, [{"type": "get", "key": "missing", "now": 0}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[null]'), "regression-c6b2e84fd11f761d")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_ttl_lru_scenario_09(self):
        args = json.loads('[1, [{"type": "put", "key": "a", "value": "alive", "ttl": 10, "now": 0}, {"type": "put", "key": "b", "value": "expired", "ttl": 0, "now": 1}, {"type": "get", "key": "a", "now": 1}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["alive"]'), "regression-c6b2e84fd11f761d")
        self.assertEqual(args, before, "caller-owned input changed")

