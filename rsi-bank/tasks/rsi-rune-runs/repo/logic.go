package task

 type Run struct { Symbol rune; Count int }

func Evaluate(text string) []Run {
    out := []Run{}
    for i := 0; i < len(text)-1; i++ {
        out = append(out, Run{rune(text[i]), 1})
    }
    return out
}
