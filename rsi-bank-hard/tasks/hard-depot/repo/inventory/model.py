from dataclasses import dataclass
from decimal import Decimal
@dataclass(frozen=True)
class Record:
    identity: str
    revision: int
    at: str
    sku: str
    warehouse: str
    quantity: Decimal
    deleted: bool=False
    def day(self):
        return self.at[:10]
    def group(self):
        return (self.warehouse,self.sku)
