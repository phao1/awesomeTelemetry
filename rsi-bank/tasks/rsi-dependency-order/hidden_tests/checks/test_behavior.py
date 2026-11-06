import copy
import json
import unittest
from logic import evaluate


class Behavior(unittest.TestCase):
    def test_dependency_order_scenario_01(self):
        args = json.loads('[{"amber-build": ["z"], "z": []}]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["z", "amber-build"]'), "regression-417b02906baa74ed")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_dependency_order_scenario_02(self):
        args = json.loads('[{}]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[]'), "regression-417b02906baa74ed")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_dependency_order_scenario_03(self):
        args = json.loads('[{"a": ["a"]}]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('null'), "regression-417b02906baa74ed")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_dependency_order_scenario_04(self):
        args = json.loads('[{"a": ["b"], "b": ["a"]}]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('null'), "regression-417b02906baa74ed")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_dependency_order_scenario_05(self):
        args = json.loads('[{"a": ["c", "b"], "b": ["d"], "c": ["d"]}]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["d", "b", "c", "a"]'), "regression-417b02906baa74ed")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_dependency_order_scenario_06(self):
        args = json.loads('[{"a": ["z", "z"]}]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["z", "a"]'), "regression-417b02906baa74ed")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_dependency_order_scenario_07(self):
        args = json.loads('[{"b": [], "a": []}]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["a", "b"]'), "regression-417b02906baa74ed")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_dependency_order_scenario_08(self):
        args = json.loads('[{"a": [], "z": ["y"], "y": ["z"]}]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('null'), "regression-417b02906baa74ed")
        self.assertEqual(args, before, "caller-owned input changed")

