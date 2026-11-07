from decimal import Decimal
from .keys import group_key
from .quantities import render

def project(records,day):
    totals={}
    labels={}
    counts={}
    for record in records.values():
        if record.deleted or record.day()!=day:
            continue
        key=group_key(record.warehouse,record.sku)
        totals[key]=totals.get(key,Decimal(0))+record.quantity
        counts[key]=counts.get(key,0)+1
        labels[key]=record.group()
    output=[]
    for key in totals:
        warehouse,sku=labels[key]
        output.append({'warehouse':warehouse,'sku':sku,'quantity':render(totals[key]),'count':counts[key]})
    return sorted(output,key=lambda row:(row['warehouse'],row['sku']))
