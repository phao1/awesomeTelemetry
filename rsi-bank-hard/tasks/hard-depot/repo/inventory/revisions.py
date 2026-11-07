def newest(records):
    result={}
    for record in records:
        result[record.identity]=record
    return result
