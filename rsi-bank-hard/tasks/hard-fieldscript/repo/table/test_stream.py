import unittest
from table import Reader
class Basic(unittest.TestCase):
    def test_original_record(self):
        self.assertEqual(Reader().feed(b'row|a|v\n',True),[{'a':'v'}])
