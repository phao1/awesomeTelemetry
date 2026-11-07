from dataclasses import replace
from .quantities import number

def corrected(record,quantity=None,warehouse=None,at=None):
    return replace(record,revision=record.revision+1,
        quantity=number(quantity) if quantity else record.quantity,
        warehouse=warehouse if warehouse is not None else record.warehouse,
        at=at if at is not None else record.at)
