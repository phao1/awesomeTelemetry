package task

import (
    "reflect"
    "encoding/json"
    "testing"
)

func TestIntervalContactScenario01(t *testing.T) {
    arg0 := [2]int{1,3}
    arg1 := [2]int{3,5}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := false
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-4a65c7400b0fde0b: got %#v; want %#v", got, want) }
}

func TestIntervalContactScenario02(t *testing.T) {
    arg0 := [2]int{1,4}
    arg1 := [2]int{3,5}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := true
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-4a65c7400b0fde0b: got %#v; want %#v", got, want) }
}

func TestIntervalContactScenario03(t *testing.T) {
    arg0 := [2]int{2,2}
    arg1 := [2]int{1,3}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := false
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-4a65c7400b0fde0b: got %#v; want %#v", got, want) }
}

func TestIntervalContactScenario04(t *testing.T) {
    arg0 := [2]int{1,3}
    arg1 := [2]int{2,2}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := false
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-4a65c7400b0fde0b: got %#v; want %#v", got, want) }
}

func TestIntervalContactScenario05(t *testing.T) {
    arg0 := [2]int{-5,-2}
    arg1 := [2]int{-3,0}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := true
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-4a65c7400b0fde0b: got %#v; want %#v", got, want) }
}

func TestIntervalContactScenario06(t *testing.T) {
    arg0 := [2]int{1,2}
    arg1 := [2]int{4,5}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := false
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-4a65c7400b0fde0b: got %#v; want %#v", got, want) }
}

func TestIntervalContactScenario07(t *testing.T) {
    arg0 := [2]int{0,4}
    arg1 := [2]int{0,4}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := true
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-4a65c7400b0fde0b: got %#v; want %#v", got, want) }
}

func TestIntervalContactScenario08(t *testing.T) {
    arg0 := [2]int{3,5}
    arg1 := [2]int{1,3}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := false
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-4a65c7400b0fde0b: got %#v; want %#v", got, want) }
}

