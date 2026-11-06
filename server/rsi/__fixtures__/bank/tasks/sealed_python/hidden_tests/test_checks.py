import unittest
from answer import answer
class Checks(unittest.TestCase):
    def test_result(self):
        self.assertEqual(answer(), 3)
