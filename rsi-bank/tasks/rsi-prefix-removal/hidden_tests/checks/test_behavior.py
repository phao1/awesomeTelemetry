import copy
import json
import unittest
from logic import evaluate


class Behavior(unittest.TestCase):
    def test_prefix_removal_scenario_01(self):
        args = json.loads('["cypress-prefix:ready", "cypress-prefix:"]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('"ready"'), "regression-d40ded0ea5c71b72")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_prefix_removal_scenario_02(self):
        args = json.loads('["abacus", "ab"]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('"acus"'), "regression-d40ded0ea5c71b72")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_prefix_removal_scenario_03(self):
        args = json.loads('["cab", "ab"]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('"cab"'), "regression-d40ded0ea5c71b72")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_prefix_removal_scenario_04(self):
        args = json.loads('["abab", "ab"]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('"ab"'), "regression-d40ded0ea5c71b72")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_prefix_removal_scenario_05(self):
        args = json.loads('[" x ", ""]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('" x "'), "regression-d40ded0ea5c71b72")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_prefix_removal_scenario_06(self):
        args = json.loads('["", "a"]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('""'), "regression-d40ded0ea5c71b72")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_prefix_removal_scenario_07(self):
        args = json.loads('["ab tail ab", "ab"]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('" tail ab"'), "regression-d40ded0ea5c71b72")
        self.assertEqual(args, before, "caller-owned input changed")

