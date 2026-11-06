package task

import "sort"

func Evaluate(graph map[string][]string) [][]string {
    pending := map[string]bool{}
    for name := range graph { pending[name] = true }
    done := map[string]bool{}
    waves := [][]string{}
    for len(pending) > 0 {
        wave := []string{}
        for name := range pending {
            if ready(graph[name], done) { wave = append(wave, name) }
        }
        if len(wave) == 0 { return waves }
        sort.Strings(wave)
        for _, name := range wave { done[name] = true; delete(pending, name) }
        waves = append(waves, wave)
    }
    return waves
}
