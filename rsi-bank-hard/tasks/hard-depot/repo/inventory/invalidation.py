def changed_days(before,after):
    return {record.day() for key,record in after.items() if before.get(key)!=record}
