from .scopes import Scopes
class Reader:
    def __init__(self):
        self.pending=b''
        self.scopes=Scopes()
    def feed(self,data,final=False):
        self.pending+=data
        lines=self.pending.split(b'\n')
        self.pending=lines.pop()
        if final:
            lines.append(self.pending)
            self.pending=b''
        output=[]
        for line in lines:
            if line:
                output.extend(self.scopes.row(line.decode('utf-8').split('|')))
        return output
