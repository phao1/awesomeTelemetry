from copy import deepcopy
from .projection import project
class Views:
    def __init__(self):
        self.rows={}
        self.hits=0
        self.misses=0
    def invalidate(self,days):
        for day in days:
            self.rows.pop(day,None)
    def day(self,records,day):
        if day in self.rows:
            self.hits+=1
        else:
            self.misses+=1
            self.rows[day]=project(records,day)
        return deepcopy(self.rows[day])
