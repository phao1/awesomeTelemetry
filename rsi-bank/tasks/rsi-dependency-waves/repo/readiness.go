package task

func ready(deps []string, done map[string]bool) bool {
    for _, dep := range deps { if done[dep] { return true } }
    return len(deps) == 0
}
