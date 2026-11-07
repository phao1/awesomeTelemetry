import unittest
from ledger import Ledger
from cells import Cells
class BoundedCells(Cells):
    def __init__(self,limit):
        super().__init__()
        self.limit=limit
    def read(self,address):
        if self.accesses>=self.limit:
            raise AssertionError('cell budget')
        return super().read(address)
    def write(self,address,value):
        if self.accesses>=self.limit:
            raise AssertionError('cell budget')
        return super().write(address,value)

class Acceptance(unittest.TestCase):
    def test_contour_interaction_000(self):
        x=Ledger(39,Cells())
        model={}
        state=1
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_001(self):
        x=Ledger(39,Cells())
        model={}
        state=2
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_002(self):
        x=Ledger(39,Cells())
        model={}
        state=3
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_003(self):
        x=Ledger(39,Cells())
        model={}
        state=4
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_004(self):
        x=Ledger(39,Cells())
        model={}
        state=5
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_005(self):
        x=Ledger(39,Cells())
        model={}
        state=6
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_006(self):
        x=Ledger(39,Cells())
        model={}
        state=7
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_007(self):
        x=Ledger(39,Cells())
        model={}
        state=8
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_008(self):
        x=Ledger(39,Cells())
        model={}
        state=9
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_009(self):
        x=Ledger(39,Cells())
        model={}
        state=10
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_010(self):
        x=Ledger(39,Cells())
        model={}
        state=11
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_011(self):
        x=Ledger(39,Cells())
        model={}
        state=12
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_012(self):
        x=Ledger(39,Cells())
        model={}
        state=13
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_013(self):
        x=Ledger(39,Cells())
        model={}
        state=14
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_014(self):
        x=Ledger(39,Cells())
        model={}
        state=15
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_015(self):
        x=Ledger(39,Cells())
        model={}
        state=16
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_016(self):
        x=Ledger(39,Cells())
        model={}
        state=17
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_017(self):
        x=Ledger(39,Cells())
        model={}
        state=18
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_018(self):
        x=Ledger(39,Cells())
        model={}
        state=19
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_019(self):
        x=Ledger(39,Cells())
        model={}
        state=20
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_020(self):
        x=Ledger(39,Cells())
        model={}
        state=21
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_021(self):
        x=Ledger(39,Cells())
        model={}
        state=22
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_022(self):
        x=Ledger(39,Cells())
        model={}
        state=23
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_023(self):
        x=Ledger(39,Cells())
        model={}
        state=24
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_024(self):
        x=Ledger(39,Cells())
        model={}
        state=25
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_025(self):
        x=Ledger(39,Cells())
        model={}
        state=26
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_026(self):
        x=Ledger(39,Cells())
        model={}
        state=27
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_027(self):
        x=Ledger(39,Cells())
        model={}
        state=28
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_028(self):
        x=Ledger(39,Cells())
        model={}
        state=29
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_029(self):
        x=Ledger(39,Cells())
        model={}
        state=30
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_030(self):
        x=Ledger(39,Cells())
        model={}
        state=31
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_031(self):
        x=Ledger(39,Cells())
        model={}
        state=32
        for tick in range(100):
            state=(state*1103515245+12345)%(2**31)
            name=str(state%13)
            a=(state//13)%40
            b=a+(state//521)%(40-a)
            start=state%29-14
            step=state%11-5
            if tick%5==0:
                self.assertEqual(x.remove(name),name in model)
                model.pop(name,None)
            else:
                x.put(name,a,b,start,step)
                model[name]=(a,b,start,step)
            values=[sum(s+(i-l)*d for l,r,s,d in model.values() if l<=i<r) for i in range(39)]
            for j in range(-1,41):
                self.assertEqual(x.sum(-8,j),sum(values[:max(0,min(39,j))]))
                self.assertEqual(x.sum(j,48),sum(values[max(0,min(39,j)):]))
    def test_contour_interaction_032(self):
        cells=BoundedCells(128*(1000000000000+2).bit_length())
        x=Ledger(0,cells)
        self.assertEqual(cells.accesses,0)
        for tick in range(20):
            cells.reset()
            x.put('a',0,0,tick-5,-2)
            self.assertLessEqual(cells.accesses,128*(0+2).bit_length())
            cells.reset()
            self.assertEqual(x.sum(0,0),0*(tick-5)-0*(0-1))
            self.assertLessEqual(cells.accesses,128*(0+2).bit_length())
        self.assertTrue(x.remove('a'))
        self.assertEqual(x.sum(0,0),0)
        cells.reset()
        self.assertFalse(x.remove('a'))
        self.assertEqual(cells.accesses,0)
    def test_contour_interaction_033(self):
        cells=BoundedCells(128*(1000000000000+2).bit_length())
        x=Ledger(1,cells)
        self.assertEqual(cells.accesses,0)
        for tick in range(20):
            cells.reset()
            x.put('a',0,1,tick-5,-2)
            self.assertLessEqual(cells.accesses,128*(1+2).bit_length())
            cells.reset()
            self.assertEqual(x.sum(0,1),1*(tick-5)-1*(1-1))
            self.assertLessEqual(cells.accesses,128*(1+2).bit_length())
        self.assertTrue(x.remove('a'))
        self.assertEqual(x.sum(0,1),0)
        cells.reset()
        self.assertFalse(x.remove('a'))
        self.assertEqual(cells.accesses,0)
    def test_contour_interaction_034(self):
        cells=BoundedCells(128*(1000000000000+2).bit_length())
        x=Ledger(9,cells)
        self.assertEqual(cells.accesses,0)
        for tick in range(20):
            cells.reset()
            x.put('a',0,9,tick-5,-2)
            self.assertLessEqual(cells.accesses,128*(9+2).bit_length())
            cells.reset()
            self.assertEqual(x.sum(0,9),9*(tick-5)-9*(9-1))
            self.assertLessEqual(cells.accesses,128*(9+2).bit_length())
        self.assertTrue(x.remove('a'))
        self.assertEqual(x.sum(0,9),0)
        cells.reset()
        self.assertFalse(x.remove('a'))
        self.assertEqual(cells.accesses,0)
    def test_contour_interaction_035(self):
        cells=BoundedCells(128*(1000000000000+2).bit_length())
        x=Ledger(1000,cells)
        self.assertEqual(cells.accesses,0)
        for tick in range(20):
            cells.reset()
            x.put('a',0,1000,tick-5,-2)
            self.assertLessEqual(cells.accesses,128*(1000+2).bit_length())
            cells.reset()
            self.assertEqual(x.sum(0,1000),1000*(tick-5)-1000*(1000-1))
            self.assertLessEqual(cells.accesses,128*(1000+2).bit_length())
        self.assertTrue(x.remove('a'))
        self.assertEqual(x.sum(0,1000),0)
        cells.reset()
        self.assertFalse(x.remove('a'))
        self.assertEqual(cells.accesses,0)
    def test_contour_interaction_036(self):
        cells=BoundedCells(128*(1000000000000+2).bit_length())
        x=Ledger(1000000000000,cells)
        self.assertEqual(cells.accesses,0)
        for tick in range(20):
            cells.reset()
            x.put('a',0,1000000000000,tick-5,-2)
            self.assertLessEqual(cells.accesses,128*(1000000000000+2).bit_length())
            cells.reset()
            self.assertEqual(x.sum(0,1000000000000),1000000000000*(tick-5)-1000000000000*(1000000000000-1))
            self.assertLessEqual(cells.accesses,128*(1000000000000+2).bit_length())
        self.assertTrue(x.remove('a'))
        self.assertEqual(x.sum(0,1000000000000),0)
        cells.reset()
        self.assertFalse(x.remove('a'))
        self.assertEqual(cells.accesses,0)
    def test_contour_interaction_037(self):
        x=Ledger(8,Cells())
        x.put('a',0,8,3,2)
        with self.assertRaises(ValueError):
            x.put('a',0,9,0,0)
        self.assertEqual(x.sum(0,8),80)
    def test_contour_interaction_038(self):
        x=Ledger(8,Cells())
        x.put('a',0,8,1,0)
        with self.assertRaises(ValueError):
            x.batch([('a',0,8,9,0),('b',0,9,0,0)])
        self.assertEqual(x.sum(0,8),8)
    def test_contour_interaction_039(self):
        x=Ledger(8,Cells())
        x.batch([('a',0,8,2,1),('a',1,3,0,-2),('b',0,0,7,2)])
        self.assertEqual(x.sum(0,8),-2)
        self.assertTrue(x.remove('b'))
    def test_contour_interaction_040(self):
        x=Ledger(8,Cells())
        def changes():
            yield ('a',0,8,7,0)
            raise RuntimeError('iterator')
        with self.assertRaises(RuntimeError):
            x.batch(changes())
        self.assertEqual(x.sum(0,8),0)
    def test_contour_interaction_041(self):
        x=Ledger(8,Cells())
        for args in [(False,2,1,0),(0,2,True,0),(0,2,1,1.0)]:
            with self.assertRaises(ValueError):
                x.put('a',*args)
        with self.assertRaises(ValueError):
            x.sum(3,2)
