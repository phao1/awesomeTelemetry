package task

func Evaluate(left, right []int) []int {
    out := []int{}
    i, j := 0, 0
    for i < len(left) && j < len(right) {
        if left[i] < right[j] { out = append(out, left[i]); i++ } else { out = append(out, right[j]); j++ }
    }
    return out
}
