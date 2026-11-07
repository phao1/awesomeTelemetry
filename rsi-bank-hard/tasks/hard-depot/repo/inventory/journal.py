from .revisions import newest
class Journal:
    def __init__(self):
        self.records=[]
        self.identities={}
    def append(self,records):
        pending={}
        added=[]
        for record in records:
            key=(record.identity,record.revision)
            old=pending.get(key,self.identities.get(key))
            if old is not None:
                if old!=record:
                    raise ValueError('revision conflict')
                continue
            pending[key]=record
            added.append(record)
        self.records.extend(added)
        self.identities.update(pending)
        return added
    def current(self):
        return newest(self.records)
    def history(self,identity):
        return sorted((row for row in self.records if row.identity==identity),key=lambda row:row.revision)
    def snapshot(self):
        return list(self.records)
