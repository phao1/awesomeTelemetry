import copy
import json
import unittest
from logic import evaluate


class Behavior(unittest.TestCase):
    def test_latest_record_scenario_01(self):
        args = json.loads('[[{"id": "peony-record", "revision": 2, "value": "new"}, {"id": "peony-record", "revision": 1, "value": "old"}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[{"id": "peony-record", "revision": 2, "value": "new"}]'), "regression-727b256c5cd9f474")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_latest_record_scenario_02(self):
        args = json.loads('[[{"id": "a", "revision": 1, "value": "first"}, {"id": "a", "revision": 1, "value": "last"}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[{"id": "a", "revision": 1, "value": "first"}]'), "regression-727b256c5cd9f474")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_latest_record_scenario_03(self):
        args = json.loads('[[]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[]'), "regression-727b256c5cd9f474")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_latest_record_scenario_04(self):
        args = json.loads('[[{"id": "a", "revision": -1, "value": null}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[{"id": "a", "revision": -1, "value": null}]'), "regression-727b256c5cd9f474")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_latest_record_scenario_05(self):
        args = json.loads('[[{"id": "b", "revision": 1, "value": "x"}, {"id": "a", "revision": 1, "value": "y"}, {"id": "b", "revision": 2, "value": "z"}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[{"id": "b", "revision": 2, "value": "z"}, {"id": "a", "revision": 1, "value": "y"}]'), "regression-727b256c5cd9f474")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_latest_record_scenario_06(self):
        args = json.loads('[[{"id": "a", "revision": 0, "value": false}, {"id": "a", "revision": 1, "value": true}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[{"id": "a", "revision": 1, "value": true}]'), "regression-727b256c5cd9f474")
        self.assertEqual(args, before, "caller-owned input changed")

