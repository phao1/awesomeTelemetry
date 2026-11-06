package task

func Evaluate(a, b [2]int) bool {
    return a[0] <= b[1] && b[0] <= a[1]
}
