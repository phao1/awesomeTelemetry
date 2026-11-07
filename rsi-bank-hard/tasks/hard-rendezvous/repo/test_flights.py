import unittest
from scheduler import Loop
from flights import Flights
class Basic(unittest.TestCase):
    def test_single_load(self):
        loop=Loop();done=[];seen=[]
        f=Flights(loop,lambda key,complete: done.append(complete) or (lambda:None))
        f.subscribe('a',lambda e,v:seen.append((e,v)))
        loop.drain();done[0](None,3);loop.drain()
        self.assertEqual(seen,[(None,3)])
