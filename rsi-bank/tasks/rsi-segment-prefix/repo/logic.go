package task

import "strings"

func Evaluate(root, candidate string) bool {
    return strings.HasPrefix(candidate, root)
}
