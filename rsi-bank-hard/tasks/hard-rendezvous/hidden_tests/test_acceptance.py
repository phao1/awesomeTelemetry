import unittest
from flights import Flights
from scheduler import Loop

def setup(ttl=5):
    loop=Loop()
    pending=[]
    cancelled=[]
    def loader(key,done):
        pending.append((key,done))
        index=len(pending)-1
        return lambda:cancelled.append(index)
    return loop,Flights(loop,loader,ttl),pending,cancelled

class Acceptance(unittest.TestCase):
    def test_rendezvous_interaction_000(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        stop=f.subscribe('k',lambda e,v:a.append((e,v)))
        
        self.assertTrue(stop())
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        for key,done in pending[:-1]:
            done(None,'old')
        pending[-1][1](None,0)
        loop.drain()
        self.assertEqual(a,[])
        self.assertEqual(b,[(None,0)])
        self.assertEqual(cancelled,[])
    def test_rendezvous_interaction_001(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        f.invalidate('k')
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        pending[0][1](None,'stale')
        pending[1][1](None,0)
        loop.drain()
        self.assertEqual(a,[('invalidated',None)])
        self.assertEqual(b,[(None,0)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_002(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        stop=f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        self.assertTrue(stop())
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        for key,done in pending[:-1]:
            done(None,'old')
        pending[-1][1](None,1)
        loop.drain()
        self.assertEqual(a,[])
        self.assertEqual(b,[(None,1)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_003(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        f.invalidate('k')
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        pending[0][1](None,'stale')
        pending[1][1](None,1)
        loop.drain()
        self.assertEqual(a,[('invalidated',None)])
        self.assertEqual(b,[(None,1)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_004(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        stop=f.subscribe('k',lambda e,v:a.append((e,v)))
        
        self.assertTrue(stop())
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        for key,done in pending[:-1]:
            done(None,'old')
        pending[-1][1](None,2)
        loop.drain()
        self.assertEqual(a,[])
        self.assertEqual(b,[(None,2)])
        self.assertEqual(cancelled,[])
    def test_rendezvous_interaction_005(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        f.invalidate('k')
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        pending[0][1](None,'stale')
        pending[1][1](None,2)
        loop.drain()
        self.assertEqual(a,[('invalidated',None)])
        self.assertEqual(b,[(None,2)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_006(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        stop=f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        self.assertTrue(stop())
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        for key,done in pending[:-1]:
            done(None,'old')
        pending[-1][1](None,3)
        loop.drain()
        self.assertEqual(a,[])
        self.assertEqual(b,[(None,3)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_007(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        f.invalidate('k')
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        pending[0][1](None,'stale')
        pending[1][1](None,3)
        loop.drain()
        self.assertEqual(a,[('invalidated',None)])
        self.assertEqual(b,[(None,3)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_008(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        stop=f.subscribe('k',lambda e,v:a.append((e,v)))
        
        self.assertTrue(stop())
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        for key,done in pending[:-1]:
            done(None,'old')
        pending[-1][1](None,4)
        loop.drain()
        self.assertEqual(a,[])
        self.assertEqual(b,[(None,4)])
        self.assertEqual(cancelled,[])
    def test_rendezvous_interaction_009(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        f.invalidate('k')
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        pending[0][1](None,'stale')
        pending[1][1](None,4)
        loop.drain()
        self.assertEqual(a,[('invalidated',None)])
        self.assertEqual(b,[(None,4)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_010(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        stop=f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        self.assertTrue(stop())
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        for key,done in pending[:-1]:
            done(None,'old')
        pending[-1][1](None,5)
        loop.drain()
        self.assertEqual(a,[])
        self.assertEqual(b,[(None,5)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_011(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        f.invalidate('k')
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        pending[0][1](None,'stale')
        pending[1][1](None,5)
        loop.drain()
        self.assertEqual(a,[('invalidated',None)])
        self.assertEqual(b,[(None,5)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_012(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        stop=f.subscribe('k',lambda e,v:a.append((e,v)))
        
        self.assertTrue(stop())
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        for key,done in pending[:-1]:
            done(None,'old')
        pending[-1][1](None,6)
        loop.drain()
        self.assertEqual(a,[])
        self.assertEqual(b,[(None,6)])
        self.assertEqual(cancelled,[])
    def test_rendezvous_interaction_013(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        f.invalidate('k')
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        pending[0][1](None,'stale')
        pending[1][1](None,6)
        loop.drain()
        self.assertEqual(a,[('invalidated',None)])
        self.assertEqual(b,[(None,6)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_014(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        stop=f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        self.assertTrue(stop())
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        for key,done in pending[:-1]:
            done(None,'old')
        pending[-1][1](None,7)
        loop.drain()
        self.assertEqual(a,[])
        self.assertEqual(b,[(None,7)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_015(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        f.invalidate('k')
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        pending[0][1](None,'stale')
        pending[1][1](None,7)
        loop.drain()
        self.assertEqual(a,[('invalidated',None)])
        self.assertEqual(b,[(None,7)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_016(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        stop=f.subscribe('k',lambda e,v:a.append((e,v)))
        
        self.assertTrue(stop())
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        for key,done in pending[:-1]:
            done(None,'old')
        pending[-1][1](None,8)
        loop.drain()
        self.assertEqual(a,[])
        self.assertEqual(b,[(None,8)])
        self.assertEqual(cancelled,[])
    def test_rendezvous_interaction_017(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        f.invalidate('k')
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        pending[0][1](None,'stale')
        pending[1][1](None,8)
        loop.drain()
        self.assertEqual(a,[('invalidated',None)])
        self.assertEqual(b,[(None,8)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_018(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        stop=f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        self.assertTrue(stop())
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        for key,done in pending[:-1]:
            done(None,'old')
        pending[-1][1](None,9)
        loop.drain()
        self.assertEqual(a,[])
        self.assertEqual(b,[(None,9)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_019(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        f.invalidate('k')
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        pending[0][1](None,'stale')
        pending[1][1](None,9)
        loop.drain()
        self.assertEqual(a,[('invalidated',None)])
        self.assertEqual(b,[(None,9)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_020(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        stop=f.subscribe('k',lambda e,v:a.append((e,v)))
        
        self.assertTrue(stop())
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        for key,done in pending[:-1]:
            done(None,'old')
        pending[-1][1](None,10)
        loop.drain()
        self.assertEqual(a,[])
        self.assertEqual(b,[(None,10)])
        self.assertEqual(cancelled,[])
    def test_rendezvous_interaction_021(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        f.invalidate('k')
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        pending[0][1](None,'stale')
        pending[1][1](None,10)
        loop.drain()
        self.assertEqual(a,[('invalidated',None)])
        self.assertEqual(b,[(None,10)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_022(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        stop=f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        self.assertTrue(stop())
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        for key,done in pending[:-1]:
            done(None,'old')
        pending[-1][1](None,11)
        loop.drain()
        self.assertEqual(a,[])
        self.assertEqual(b,[(None,11)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_023(self):
        loop,f,pending,cancelled=setup()
        a=[];b=[]
        f.subscribe('k',lambda e,v:a.append((e,v)))
        loop.drain()
        f.invalidate('k')
        f.subscribe('k',lambda e,v:b.append((e,v)))
        loop.drain()
        pending[0][1](None,'stale')
        pending[1][1](None,11)
        loop.drain()
        self.assertEqual(a,[('invalidated',None)])
        self.assertEqual(b,[(None,11)])
        self.assertEqual(cancelled,[0])
    def test_rendezvous_interaction_024(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)))
        
        
        
        f.close();f.close();loop.drain()
        self.assertEqual(seen,[('closed', None)])
        if pending:
            pending[0][1](None,9)
        loop.drain()
        self.assertEqual(len(seen),1)
    def test_rendezvous_interaction_025(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)))
        loop.drain()
        
        
        f.close();f.close();loop.drain()
        self.assertEqual(seen,[('closed', None)])
        if pending:
            pending[0][1](None,9)
        loop.drain()
        self.assertEqual(len(seen),1)
    def test_rendezvous_interaction_026(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)))
        loop.drain()
        pending[0][1](None,7)
        
        f.close();f.close();loop.drain()
        self.assertEqual(seen,[('closed', None)])
        if pending:
            pending[0][1](None,9)
        loop.drain()
        self.assertEqual(len(seen),1)
    def test_rendezvous_interaction_027(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)))
        loop.drain()
        pending[0][1](None,7)
        loop.drain();f.subscribe("k",lambda e,v:seen.append((e,v)))
        f.close();f.close();loop.drain()
        self.assertEqual(seen,[(None, 7), ('closed', None)])
        if pending:
            pending[0][1](None,9)
        loop.drain()
        self.assertEqual(len(seen),2)
    def test_rendezvous_interaction_028(self):
        loop,f,pending,cancelled=setup(0)
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain();pending[0][1](None,7);loop.drain()
        loop.advance(0)
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain()
        self.assertEqual(len(pending),2)
        if len(pending)>1:
            pending[-1][1](None,8);loop.drain()
        self.assertEqual(seen,[(None,7),(None,8)])
    def test_rendezvous_interaction_029(self):
        loop,f,pending,cancelled=setup(0)
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain();pending[0][1](None,7);loop.drain()
        loop.advance(1)
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain()
        self.assertEqual(len(pending),2)
        if len(pending)>1:
            pending[-1][1](None,8);loop.drain()
        self.assertEqual(seen,[(None,7),(None,8)])
    def test_rendezvous_interaction_030(self):
        loop,f,pending,cancelled=setup(0)
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain();pending[0][1](None,7);loop.drain()
        loop.advance(5)
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain()
        self.assertEqual(len(pending),2)
        if len(pending)>1:
            pending[-1][1](None,8);loop.drain()
        self.assertEqual(seen,[(None,7),(None,8)])
    def test_rendezvous_interaction_031(self):
        loop,f,pending,cancelled=setup(0)
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain();pending[0][1](None,7);loop.drain()
        loop.advance(6)
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain()
        self.assertEqual(len(pending),2)
        if len(pending)>1:
            pending[-1][1](None,8);loop.drain()
        self.assertEqual(seen,[(None,7),(None,8)])
    def test_rendezvous_interaction_032(self):
        loop,f,pending,cancelled=setup(1)
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain();pending[0][1](None,7);loop.drain()
        loop.advance(0)
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain()
        self.assertEqual(len(pending),1)
        if len(pending)>1:
            pending[-1][1](None,8);loop.drain()
        self.assertEqual(seen,[(None,7),(None,7)])
    def test_rendezvous_interaction_033(self):
        loop,f,pending,cancelled=setup(1)
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain();pending[0][1](None,7);loop.drain()
        loop.advance(1)
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain()
        self.assertEqual(len(pending),2)
        if len(pending)>1:
            pending[-1][1](None,8);loop.drain()
        self.assertEqual(seen,[(None,7),(None,8)])
    def test_rendezvous_interaction_034(self):
        loop,f,pending,cancelled=setup(1)
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain();pending[0][1](None,7);loop.drain()
        loop.advance(5)
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain()
        self.assertEqual(len(pending),2)
        if len(pending)>1:
            pending[-1][1](None,8);loop.drain()
        self.assertEqual(seen,[(None,7),(None,8)])
    def test_rendezvous_interaction_035(self):
        loop,f,pending,cancelled=setup(1)
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain();pending[0][1](None,7);loop.drain()
        loop.advance(6)
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain()
        self.assertEqual(len(pending),2)
        if len(pending)>1:
            pending[-1][1](None,8);loop.drain()
        self.assertEqual(seen,[(None,7),(None,8)])
    def test_rendezvous_interaction_036(self):
        loop,f,pending,cancelled=setup(5)
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain();pending[0][1](None,7);loop.drain()
        loop.advance(0)
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain()
        self.assertEqual(len(pending),1)
        if len(pending)>1:
            pending[-1][1](None,8);loop.drain()
        self.assertEqual(seen,[(None,7),(None,7)])
    def test_rendezvous_interaction_037(self):
        loop,f,pending,cancelled=setup(5)
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain();pending[0][1](None,7);loop.drain()
        loop.advance(1)
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain()
        self.assertEqual(len(pending),1)
        if len(pending)>1:
            pending[-1][1](None,8);loop.drain()
        self.assertEqual(seen,[(None,7),(None,7)])
    def test_rendezvous_interaction_038(self):
        loop,f,pending,cancelled=setup(5)
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain();pending[0][1](None,7);loop.drain()
        loop.advance(5)
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain()
        self.assertEqual(len(pending),2)
        if len(pending)>1:
            pending[-1][1](None,8);loop.drain()
        self.assertEqual(seen,[(None,7),(None,8)])
    def test_rendezvous_interaction_039(self):
        loop,f,pending,cancelled=setup(5)
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain();pending[0][1](None,7);loop.drain()
        loop.advance(6)
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain()
        self.assertEqual(len(pending),2)
        if len(pending)>1:
            pending[-1][1](None,8);loop.drain()
        self.assertEqual(seen,[(None,7),(None,8)])
    def test_rendezvous_interaction_040(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stop=f.subscribe('k',lambda e,v:seen.append(v));loop.drain();pending[0][1](None,3);self.assertTrue(stop());loop.drain();self.assertEqual(seen,[])
        self.assertFalse(stop())
    def test_rendezvous_interaction_041(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        f.subscribe('k',lambda e,v:(_ for _ in ()).throw(RuntimeError('subscriber')))
        f.subscribe('k',lambda e,v:seen.append(v))
        loop.drain();pending[0][1](None,3);pending[0][1](None,4);loop.drain()
        self.assertEqual(seen,[3]);self.assertEqual(loop.errors,['subscriber'])
    def test_rendezvous_interaction_042(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        f.subscribe('k',lambda e,v:v.append(9));f.subscribe('k',lambda e,v:seen.append(v))
        loop.drain();pending[0][1](None,[1]);loop.drain();f.subscribe('k',lambda e,v:seen.append(v));loop.drain()
        self.assertEqual(seen,[[1],[1]])
    def test_rendezvous_interaction_043(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        callback=lambda e,v:seen.append(v)
        a=f.subscribe('k',callback);b=f.subscribe('k',callback);a();loop.drain();pending[0][1](None,4);loop.drain()
        self.assertEqual(seen,[4]);self.assertFalse(b())
    def test_rendezvous_interaction_044(self):
        loop=Loop();seen=[]
        def loader(key,done):
            done(None,4)
            return lambda:None
        f=Flights(loop,loader);f.subscribe('k',lambda e,v:seen.append(v));loop.drain();self.assertEqual(seen,[4])
    def test_rendezvous_interaction_045(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain();pending[0][1]('error',None);loop.drain();f.subscribe('k',lambda e,v:seen.append((e,v)));loop.drain()
        self.assertEqual(len(pending),2);self.assertEqual(seen,[('error',None)])
    def test_rendezvous_delivery_order_000(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 1, 2, 3, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_001(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 1, 2, 4, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_002(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 1, 3, 2, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_003(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 1, 3, 4, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_004(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 1, 4, 2, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_005(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 1, 4, 3, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_006(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 2, 1, 3, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_007(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 2, 1, 4, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_008(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 2, 3, 1, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_009(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 2, 3, 4, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_010(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 2, 4, 1, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_011(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 2, 4, 3, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_012(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 3, 1, 2, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_013(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 3, 1, 4, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_014(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 3, 2, 1, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_015(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 3, 2, 4, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_016(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 3, 4, 1, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_017(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 3, 4, 2, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_018(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 4, 1, 2, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_019(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 4, 1, 3, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_020(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 4, 2, 1, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_021(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 4, 2, 3, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_022(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 4, 3, 1, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_023(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (0, 4, 3, 2, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_024(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 0, 2, 3, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_025(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 0, 2, 4, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_026(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 0, 3, 2, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_027(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 0, 3, 4, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_028(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 0, 4, 2, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_029(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 0, 4, 3, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_030(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 2, 0, 3, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_031(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 2, 0, 4, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_032(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 2, 3, 0, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_033(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 2, 3, 4, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_034(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 2, 4, 0, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_035(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 2, 4, 3, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_036(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 3, 0, 2, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_037(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 3, 0, 4, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_038(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 3, 2, 0, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_039(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 3, 2, 4, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_040(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 3, 4, 0, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_041(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 3, 4, 2, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_042(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 4, 0, 2, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_043(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 4, 0, 3, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_044(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 4, 2, 0, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_045(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 4, 2, 3, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_046(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 4, 3, 0, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_047(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (1, 4, 3, 2, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_048(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 0, 1, 3, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_049(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 0, 1, 4, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_050(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 0, 3, 1, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_051(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 0, 3, 4, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_052(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 0, 4, 1, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_053(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 0, 4, 3, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_054(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 1, 0, 3, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_055(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 1, 0, 4, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_056(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 1, 3, 0, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_057(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 1, 3, 4, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_058(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 1, 4, 0, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_059(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 1, 4, 3, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_060(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 3, 0, 1, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_061(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 3, 0, 4, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_062(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 3, 1, 0, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_063(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 3, 1, 4, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_064(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 3, 4, 0, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_065(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 3, 4, 1, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_066(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 4, 0, 1, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_067(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 4, 0, 3, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_068(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 4, 1, 0, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_069(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 4, 1, 3, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_070(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 4, 3, 0, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_071(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (2, 4, 3, 1, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_072(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 0, 1, 2, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_073(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 0, 1, 4, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_074(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 0, 2, 1, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_075(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 0, 2, 4, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_076(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 0, 4, 1, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_077(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 0, 4, 2, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_078(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 1, 0, 2, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_079(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 1, 0, 4, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_080(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 1, 2, 0, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_081(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 1, 2, 4, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_082(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 1, 4, 0, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_083(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 1, 4, 2, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_084(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 2, 0, 1, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_085(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 2, 0, 4, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_086(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 2, 1, 0, 4):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_087(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 2, 1, 4, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_088(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 2, 4, 0, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_089(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 2, 4, 1, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_090(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 4, 0, 1, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_091(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 4, 0, 2, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_092(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 4, 1, 0, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_093(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 4, 1, 2, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_094(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 4, 2, 0, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_095(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (3, 4, 2, 1, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_096(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 0, 1, 2, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_097(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 0, 1, 3, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_098(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 0, 2, 1, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_099(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 0, 2, 3, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_100(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 0, 3, 1, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_101(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 0, 3, 2, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_102(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 1, 0, 2, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_103(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 1, 0, 3, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_104(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 1, 2, 0, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_105(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 1, 2, 3, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_106(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 1, 3, 0, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_107(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 1, 3, 2, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_108(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 2, 0, 1, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_109(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 2, 0, 3, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_110(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 2, 1, 0, 3):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_111(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 2, 1, 3, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_112(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 2, 3, 0, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_113(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 2, 3, 1, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_114(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 3, 0, 1, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_115(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 3, 0, 2, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_116(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 3, 1, 0, 2):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_117(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 3, 1, 2, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_118(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 3, 2, 0, 1):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
    def test_rendezvous_delivery_order_119(self):
        loop,f,pending,cancelled=setup()
        seen=[]
        stops=[]
        for identity in range(3):
            stops.append(f.subscribe('k',lambda e,v,identity=identity:seen.append((identity,e,v))))
        loop.drain()
        pending[0][1](None,7)
        jobs=list(loop.jobs)
        published=set()
        closed=False
        active=[True,True,True]
        expected=[]
        for action in (4, 3, 2, 1, 0):
            if action<3:
                loop.step(jobs[action])
                if active[action]:
                    expected.append((action,'closed' if closed else None,None if closed else 7))
                    active[action]=False
            elif action==3:
                self.assertEqual(stops[0](),active[0])
                active[0]=False
            else:
                f.close()
                closed=True
            self.assertEqual(seen,expected)
        loop.drain()
        self.assertEqual(seen,expected)
