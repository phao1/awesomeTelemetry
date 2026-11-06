package task

import "strings"

func Evaluate(name string) string {
    result := ""
    for _, word := range strings.Fields(name) {
        result += word[:1]
    }
    return result
}
