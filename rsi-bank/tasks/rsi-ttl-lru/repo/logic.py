from policy import purge, trim

def evaluate(capacity, operations):
    entries = {}
    output = []
    for op in operations:
        purge(entries, op["now"])
        key = op["key"]
        if op["type"] == "put":
            entries[key] = (op["value"], op["now"] + op["ttl"])
            trim(entries, capacity)
        else:
            output.append(entries.get(key, (None, None))[0])
    return output
