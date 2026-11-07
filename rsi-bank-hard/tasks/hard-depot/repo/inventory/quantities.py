from decimal import Decimal,InvalidOperation

def number(value):
    if isinstance(value,bool):
        raise ValueError('quantity')
    try:
        result=Decimal(str(value))
    except (InvalidOperation,ValueError):
        raise ValueError('quantity') from None
    if not result.is_finite():
        raise ValueError('finite quantity')
    return result

def render(value):
    if not value:
        return '0'
    return format(value.normalize(),'f')

def convert(value,unit,catalog):
    if unit not in catalog:
        raise ValueError('unit')
    return number(value)*number(catalog[unit])
