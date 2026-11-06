def available(lease, now):
    return lease is None or lease[1] < now

def acknowledge(jobs, op):
    if op["id"] not in jobs:
        return False
    del jobs[op["id"]]
    return True
