class Loop:
    def __init__(self):
        self.now=0
        self.sequence=0
        self.jobs={}
        self.errors=[]
    def soon(self, callback):
        self.sequence+=1
        self.jobs[self.sequence]=callback
        return self.sequence
    def step(self, identity=None):
        if identity is None:
            identity=min(self.jobs)
        callback=self.jobs.pop(identity)
        try:
            callback()
        except Exception as error:
            self.errors.append(str(error))
    def drain(self):
        limit=10000
        while self.jobs:
            self.step()
            limit-=1
            if limit==0:
                raise RuntimeError('livelock')
    def advance(self, delta):
        if delta<0:
            raise ValueError('time')
        self.now+=delta
