import unittest
from ledger import Ledger
from cells import Cells
class Basic(unittest.TestCase):
    def test_point_ramp(self):
        x=Ledger(5,Cells())
        x.put('a',1,4,2,1)
        self.assertEqual(x.sum(0,5),9)
