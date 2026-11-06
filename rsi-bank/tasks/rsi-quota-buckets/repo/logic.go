package task

 type Op struct { Kind, Tenant, ID string; Quantity int }
 type Hold struct { Tenant string; Quantity int }

func Evaluate(limits map[string]int, operations []Op) map[string]int {
    remaining := map[string]int{}
    for tenant, limit := range limits { remaining[tenant] = limit }
    holds := map[string]Hold{}
    for _, op := range operations {
        if op.Kind == "reserve" { reserve(remaining, holds, op) } else { cancel(remaining, holds, op) }
    }
    return remaining
}
