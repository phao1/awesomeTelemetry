def purge(entries, now):
    for key in list(entries):
        if entries[key][1] < now:
            del entries[key]

def trim(entries, capacity):
    while len(entries) > capacity:
        entries.popitem()
