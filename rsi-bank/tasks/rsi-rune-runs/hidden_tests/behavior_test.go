package task

import (
    "reflect"
    "encoding/json"
    "testing"
)

func TestRuneRunsScenario01(t *testing.T) {
    arg0 := "aaabb"
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []Run{{'a',3},{'b',2}}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-d9ff55bc27cd0164: got %#v; want %#v", got, want) }
}

func TestRuneRunsScenario02(t *testing.T) {
    arg0 := ""
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []Run{}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-d9ff55bc27cd0164: got %#v; want %#v", got, want) }
}

func TestRuneRunsScenario03(t *testing.T) {
    arg0 := "x"
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []Run{{'x',1}}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-d9ff55bc27cd0164: got %#v; want %#v", got, want) }
}

func TestRuneRunsScenario04(t *testing.T) {
    arg0 := "张张伟"
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []Run{{'张',2},{'伟',1}}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-d9ff55bc27cd0164: got %#v; want %#v", got, want) }
}

func TestRuneRunsScenario05(t *testing.T) {
    arg0 := "aba"
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []Run{{'a',1},{'b',1},{'a',1}}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-d9ff55bc27cd0164: got %#v; want %#v", got, want) }
}

func TestRuneRunsScenario06(t *testing.T) {
    arg0 := "🦊🦊!"
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []Run{{'🦊',2},{'!',1}}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-d9ff55bc27cd0164: got %#v; want %#v", got, want) }
}

func TestRuneRunsScenario07(t *testing.T) {
    arg0 := "  "
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []Run{{' ',2}}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-d9ff55bc27cd0164: got %#v; want %#v", got, want) }
}

