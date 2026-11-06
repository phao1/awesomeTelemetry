import copy
import json
import unittest
from logic import evaluate


class Behavior(unittest.TestCase):
    def test_uncovered_slots_scenario_01(self):
        args = json.loads('[0, 10, [[2, 8], [3, 4]]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[[0, 2], [8, 10]]'), "regression-365886dba08aaefd")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_uncovered_slots_scenario_02(self):
        args = json.loads('[0, 10, [[-3, 3], [8, 20]]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[[3, 8]]'), "regression-365886dba08aaefd")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_uncovered_slots_scenario_03(self):
        args = json.loads('[0, 10, [[20, 30], [-5, -1]]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[[0, 10]]'), "regression-365886dba08aaefd")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_uncovered_slots_scenario_04(self):
        args = json.loads('[0, 10, []]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[[0, 10]]'), "regression-365886dba08aaefd")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_uncovered_slots_scenario_05(self):
        args = json.loads('[3, 3, []]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[]'), "regression-365886dba08aaefd")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_uncovered_slots_scenario_06(self):
        args = json.loads('[0, 10, [[0, 5], [5, 10]]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[]'), "regression-365886dba08aaefd")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_uncovered_slots_scenario_07(self):
        args = json.loads('[0, 10, [[5, 5]]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[[0, 10]]'), "regression-365886dba08aaefd")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_uncovered_slots_scenario_08(self):
        args = json.loads('[-10, 0, [[-8, -4]]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[[-10, -8], [-4, 0]]'), "regression-365886dba08aaefd")
        self.assertEqual(args, before, "caller-owned input changed")

