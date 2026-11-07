from cache import Cache
class Flights:
    def __init__(self,loop,loader,ttl=5):
        self.loop=loop
        self.loader=loader
        self.cache=Cache(loop,ttl)
        self.running={}
        self.closed=False
    def subscribe(self,key,callback):
        hit=self.cache.lookup(key)
        token={'active':True,'callback':callback}
        if hit:
            self.loop.soon(lambda:callback(None,hit[0]))
        else:
            flight=self.running.get(key)
            if flight is None:
                flight={'tokens':[],'cancel':None}
                self.running[key]=flight
                flight['cancel']=self.loader(key,lambda error,value:self.complete(key,flight,error,value))
            flight['tokens'].append(token)
        def cancel():
            if not token['active']:
                return False
            token['active']=False
            return True
        return cancel
    def complete(self,key,flight,error,value):
        self.running.pop(key,None)
        if error is None:
            self.cache.remember(key,value)
        for token in flight['tokens']:
            self.loop.soon(lambda token=token:token['callback'](error,value) if token['active'] else None)
    def invalidate(self,key):
        self.cache.discard(key)
        self.running.pop(key,None)
    def close(self):
        self.closed=True
        self.running.clear()
