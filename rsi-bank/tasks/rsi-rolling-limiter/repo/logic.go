package task

func Evaluate(times []int, width, limit int) []bool {
    accepted := []int{}
    result := []bool{}
    for _, now := range times {
        ok := len(accepted) < limit
        result = append(result, ok)
        accepted = append(accepted, now)
    }
    return result
}
