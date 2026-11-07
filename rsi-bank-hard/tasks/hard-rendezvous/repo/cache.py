class Cache:
    def __init__(self, loop, ttl):
        self.loop=loop
        self.ttl=ttl
        self.rows={}
    def lookup(self,key):
        row=self.rows.get(key)
        return row if row and row[1]>=self.loop.now else None
    def remember(self,key,value):
        self.rows[key]=(value,self.loop.now+self.ttl)
    def discard(self,key):
        self.rows.pop(key,None)
