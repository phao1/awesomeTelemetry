import copy
import json
import unittest
from logic import evaluate


class Behavior(unittest.TestCase):
    def test_escaped_columns_scenario_01(self):
        args = json.loads('["lotus\\\\|column|x"]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["lotus|column", "x"]'), "regression-78334d5124c433ef")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_escaped_columns_scenario_02(self):
        args = json.loads('[""]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[""]'), "regression-78334d5124c433ef")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_escaped_columns_scenario_03(self):
        args = json.loads('["||"]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["", "", ""]'), "regression-78334d5124c433ef")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_escaped_columns_scenario_04(self):
        args = json.loads('["a\\\\\\\\|b"]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["a\\\\", "b"]'), "regression-78334d5124c433ef")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_escaped_columns_scenario_05(self):
        args = json.loads('["a\\\\"]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["a\\\\"]'), "regression-78334d5124c433ef")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_escaped_columns_scenario_06(self):
        args = json.loads('["a\\\\q| b "]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["aq", " b "]'), "regression-78334d5124c433ef")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_escaped_columns_scenario_07(self):
        args = json.loads('["a|"]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["a", ""]'), "regression-78334d5124c433ef")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_escaped_columns_scenario_08(self):
        args = json.loads('["\\\\|"]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["|"]'), "regression-78334d5124c433ef")
        self.assertEqual(args, before, "caller-owned input changed")

