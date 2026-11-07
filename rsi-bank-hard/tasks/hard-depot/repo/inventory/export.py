from decimal import Decimal
from .quantities import render

def total(rows):
    return render(sum((Decimal(row['quantity']) for row in rows),Decimal(0)))

def pivot(reports):
    groups={}
    for day,rows in sorted(reports.items()):
        for row in rows:
            key=(row['warehouse'],row['sku'])
            groups.setdefault(key,{})[day]=row['quantity']
    return [{'warehouse':key[0],'sku':key[1],'days':dict(days)} for key,days in sorted(groups.items())]

def reconcile(left,right):
    def keyed(rows):
        return {(row['warehouse'],row['sku']):Decimal(row['quantity']) for row in rows}
    a,b=keyed(left),keyed(right)
    return [{'warehouse':key[0],'sku':key[1],'delta':render(b.get(key,Decimal(0))-a.get(key,Decimal(0)))} for key in sorted(a.keys()|b.keys()) if a.get(key,0)!=b.get(key,0)]
