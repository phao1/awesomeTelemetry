from leases import available, acknowledge

def evaluate(operations):
    jobs, output = {}, []
    for op in operations:
        kind = op["type"]
        if kind == "enqueue":
            jobs[op["id"]] = None
        elif kind == "claim":
            key = next((k for k, lease in jobs.items() if available(lease, op["now"])), None)
            if key is not None:
                jobs[key] = (op["token"], op["now"] + op["ttl"])
            output.append(key)
        elif kind == "ack":
            output.append(acknowledge(jobs, op))
    return output
