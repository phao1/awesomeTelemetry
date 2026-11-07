class Scopes:
    def __init__(self):
        self.defaults={}
    def row(self,cells):
        if cells[0]=='row':
            return [dict(self.defaults,**dict(zip(cells[1::2],cells[2::2])))]
        if cells[0]=='set':
            self.defaults[cells[1]]=cells[2]
        return []
    def finish(self):
        pass
