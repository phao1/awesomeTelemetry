import copy
import json
import unittest
from logic import evaluate


class Behavior(unittest.TestCase):
    def test_lease_queue_scenario_01(self):
        args = json.loads('[[{"type": "enqueue", "id": "iris-lease"}, {"type": "claim", "token": "old", "now": 0, "ttl": 2}, {"type": "claim", "token": "new", "now": 2, "ttl": 2}, {"type": "ack", "id": "iris-lease", "token": "old", "now": 2}, {"type": "ack", "id": "iris-lease", "token": "new", "now": 2}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["iris-lease", "iris-lease", false, true]'), "regression-93647934568182f2")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_lease_queue_scenario_02(self):
        args = json.loads('[[{"type": "enqueue", "id": "a"}, {"type": "claim", "token": "x", "now": 0, "ttl": 2}, {"type": "enqueue", "id": "a"}, {"type": "claim", "token": "y", "now": 1, "ttl": 2}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["a", null]'), "regression-93647934568182f2")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_lease_queue_scenario_03(self):
        args = json.loads('[[{"type": "enqueue", "id": "a"}, {"type": "claim", "token": "x", "now": 0, "ttl": 2}, {"type": "ack", "id": "a", "token": "x", "now": 2}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["a", false]'), "regression-93647934568182f2")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_lease_queue_scenario_04(self):
        args = json.loads('[[{"type": "enqueue", "id": "a"}, {"type": "ack", "id": "a", "token": "x", "now": 0}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[false]'), "regression-93647934568182f2")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_lease_queue_scenario_05(self):
        args = json.loads('[[{"type": "claim", "token": "x", "now": 0, "ttl": 2}, {"type": "ack", "id": "none", "token": "x", "now": 0}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('[null, false]'), "regression-93647934568182f2")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_lease_queue_scenario_06(self):
        args = json.loads('[[{"type": "enqueue", "id": "a"}, {"type": "enqueue", "id": "b"}, {"type": "claim", "token": "x", "now": 0, "ttl": 2}, {"type": "claim", "token": "y", "now": 0, "ttl": 2}, {"type": "ack", "id": "a", "token": "x", "now": 0}, {"type": "claim", "token": "z", "now": 0, "ttl": 2}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["a", "b", true, null]'), "regression-93647934568182f2")
        self.assertEqual(args, before, "caller-owned input changed")

    def test_lease_queue_scenario_07(self):
        args = json.loads('[[{"type": "enqueue", "id": "a"}, {"type": "claim", "token": "x", "now": 0, "ttl": 2}, {"type": "ack", "id": "a", "token": "x", "now": 0}, {"type": "enqueue", "id": "a"}, {"type": "claim", "token": "z", "now": 0, "ttl": 2}]]')
        before = copy.deepcopy(args)
        self.assertEqual(evaluate(*args), json.loads('["a", true, "a"]'), "regression-93647934568182f2")
        self.assertEqual(args, before, "caller-owned input changed")

