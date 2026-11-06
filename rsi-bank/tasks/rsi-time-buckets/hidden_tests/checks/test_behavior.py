import copy
import json
import unittest
from logic import evaluate


class Behavior(unittest.TestCase):
    def test_time_buckets_scenario_01(self):
        args = json.loads('[11, 5]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('10'), "regression-29114d7fae38987a")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_time_buckets_scenario_02(self):
        args = json.loads('[-1, 5]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('-5'), "regression-29114d7fae38987a")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_time_buckets_scenario_03(self):
        args = json.loads('[-5, 5]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('-5'), "regression-29114d7fae38987a")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_time_buckets_scenario_04(self):
        args = json.loads('[0, 5]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('0'), "regression-29114d7fae38987a")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_time_buckets_scenario_05(self):
        args = json.loads('[5, 5]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('5'), "regression-29114d7fae38987a")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_time_buckets_scenario_06(self):
        args = json.loads('[-11, 5]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('-15'), "regression-29114d7fae38987a")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_time_buckets_scenario_07(self):
        args = json.loads('[1000000000000000001, 10]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('1000000000000000000'), "regression-29114d7fae38987a")
        self.assertEqual(args, before, "caller-owned input changed")

