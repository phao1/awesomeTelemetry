import copy
import json
import unittest
from logic import evaluate


class Behavior(unittest.TestCase):
    def test_batch_tail_scenario_01(self):
        args = json.loads('[["marigold-batch", "b", "c"], 2]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[["marigold-batch", "b"], ["c"]]'), "regression-f4e52c2240882bb5")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_batch_tail_scenario_02(self):
        args = json.loads('[[1, 2, 3, 4], 2]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[[1, 2], [3, 4]]'), "regression-f4e52c2240882bb5")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_batch_tail_scenario_03(self):
        args = json.loads('[[], 3]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[]'), "regression-f4e52c2240882bb5")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_batch_tail_scenario_04(self):
        args = json.loads('[[1], 5]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[[1]]'), "regression-f4e52c2240882bb5")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_batch_tail_scenario_05(self):
        args = json.loads('[[1, 2], 1]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[[1], [2]]'), "regression-f4e52c2240882bb5")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_batch_tail_scenario_06(self):
        args = json.loads('[[1, 2, 3], 3]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[[1, 2, 3]]'), "regression-f4e52c2240882bb5")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_batch_tail_scenario_07(self):
        args = json.loads('[[1, 2, 3, 4, 5], 3]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[[1, 2, 3], [4, 5]]'), "regression-f4e52c2240882bb5")
        self.assertEqual(args, before, "caller-owned input changed")

