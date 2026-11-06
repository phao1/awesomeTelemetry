import copy
import json
import unittest
from logic import evaluate


class Behavior(unittest.TestCase):
    def test_atomic_transfer_scenario_01(self):
        args = json.loads('[{"dahlia-account": 10, "b": 0}, [{"source": "dahlia-account", "target": "b", "amount": 3}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('{"dahlia-account": 7, "b": 3}'), "regression-6398b97eccf89699")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_atomic_transfer_scenario_02(self):
        args = json.loads('[{"a": 5, "b": 0}, [{"source": "a", "target": "b", "amount": 2}, {"source": "b", "target": "a", "amount": 9}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('{"a": 5, "b": 0}'), "regression-6398b97eccf89699")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_atomic_transfer_scenario_03(self):
        args = json.loads('[{"a": 5}, [{"source": "a", "target": "missing", "amount": 2}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('{"a": 5}'), "regression-6398b97eccf89699")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_atomic_transfer_scenario_04(self):
        args = json.loads('[{"a": 5, "b": 0}, [{"source": "a", "target": "b", "amount": -2}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('{"a": 5, "b": 0}'), "regression-6398b97eccf89699")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_atomic_transfer_scenario_05(self):
        args = json.loads('[{"a": 5}, [{"source": "a", "target": "a", "amount": 5}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('{"a": 5}'), "regression-6398b97eccf89699")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_atomic_transfer_scenario_06(self):
        args = json.loads('[{"a": 5, "b": 0}, [{"source": "a", "target": "b", "amount": 5}, {"source": "b", "target": "a", "amount": 1}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('{"a": 1, "b": 4}'), "regression-6398b97eccf89699")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_atomic_transfer_scenario_07(self):
        args = json.loads('[{"a": 5, "b": 0}, [{"source": "a", "target": "b", "amount": true}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('{"a": 5, "b": 0}'), "regression-6398b97eccf89699")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_atomic_transfer_scenario_08(self):
        args = json.loads('[{"a": 5, "b": 0}, [{"source": "a", "target": "b", "amount": 0}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('{"a": 5, "b": 0}'), "regression-6398b97eccf89699")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_atomic_transfer_scenario_09(self):
        args = json.loads('[{"a": 5}, []]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('{"a": 5}'), "regression-6398b97eccf89699")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_atomic_transfer_scenario_10(self):
        args = json.loads('[{"a": 5, "b": 0}, [{"source": "a", "target": "b", "amount": 2}, {"source": "a", "target": "b", "amount": 0}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('{"a": 5, "b": 0}'), "regression-6398b97eccf89699")
        self.assertEqual(args, before, "caller-owned input changed")

