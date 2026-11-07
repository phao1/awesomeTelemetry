from .model import Record
from .quantities import convert
from .time import canonical

def record(row,catalog):
    identity=row['id']
    revision=row['revision']
    if not isinstance(identity,str) or not identity:
        raise ValueError('id')
    if type(revision) is not int or revision<0:
        raise ValueError('revision')
    warehouse=row['warehouse']
    sku=row['sku']
    if not isinstance(warehouse,str) or not isinstance(sku,str):
        raise ValueError('group')
    quantity=convert(row.get('quantity',0),row.get('unit','each'),catalog)
    return Record(identity,revision,canonical(row['at']),sku,warehouse,quantity,row.get('deleted',False))
