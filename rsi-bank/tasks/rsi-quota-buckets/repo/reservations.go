package task

func reserve(remaining map[string]int, holds map[string]Hold, op Op) {
    remaining[op.Tenant] -= op.Quantity
    holds[op.ID] = Hold{op.Tenant, op.Quantity}
}
func cancel(remaining map[string]int, holds map[string]Hold, op Op) {
    hold, ok := holds[op.ID]
    if ok { remaining[op.Tenant] += hold.Quantity }
}
