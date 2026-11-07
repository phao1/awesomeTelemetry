from dataclasses import replace
from copy import deepcopy
from .journal import Journal
from .views import Views
from .normalize import record
from .corrections import corrected
from .invalidation import changed_days
from .time import canonical,day_range
from .csv_input import read
class Inventory:
    def __init__(self,units=None):
        self.units=dict(units or {'each':1,'box':12})
        self.journal=Journal()
        self.views=Views()
    def ingest(self,rows):
        prepared=[record(row,self.units) for row in rows]
        before=self.journal.current()
        added=self.journal.append(prepared)
        after=self.journal.current()
        self.views.invalidate(changed_days(before,after))
        return len(added)
    def ingest_csv(self,text):
        return self.ingest(read(text))
    def correct(self,identity,quantity=None,warehouse=None,at=None):
        before=self.journal.current()
        if identity not in before:
            raise KeyError(identity)
        value=corrected(before[identity],quantity,warehouse,canonical(at) if at is not None else None)
        self.journal.append([value])
        self.views.invalidate(changed_days(before,self.journal.current()))
        return value.revision
    def delete(self,identity):
        before=self.journal.current()
        value=before[identity]
        self.journal.append([replace(value,revision=value.revision+1,deleted=True)])
        self.views.invalidate(changed_days(before,self.journal.current()))
    def day(self,day):
        day_range(day,day)
        return self.views.day(self.journal.current(),day)
    def history(self,identity):
        return deepcopy(self.journal.history(identity))
    def checkpoint(self):
        return deepcopy(self.journal.snapshot())
    def restore(self,rows):
        journal=Journal()
        journal.append(deepcopy(rows))
        self.journal=journal
        self.views=Views()
