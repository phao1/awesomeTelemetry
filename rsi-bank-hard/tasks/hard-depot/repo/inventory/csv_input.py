import csv,io

def read(text):
    rows=[]
    for row in csv.DictReader(io.StringIO(text,newline='')):
        value=dict(row)
        value['revision']=int(value['revision'])
        value['unit']=value.get('unit') or 'each'
        if 'deleted' in value:
            if value['deleted'] not in ('true','false',''):
                raise ValueError('deleted')
            value['deleted']=value['deleted']=='true'
        rows.append(value)
    return rows

def write(rows):
    out=io.StringIO(newline='')
    columns=['id','revision','at','warehouse','sku','quantity','unit','deleted']
    writer=csv.DictWriter(out,fieldnames=columns)
    writer.writeheader()
    for row in rows:
        value=dict(row)
        if 'deleted' in value:
            value['deleted']='true' if value['deleted'] else 'false'
        writer.writerow(value)
    return out.getvalue()
