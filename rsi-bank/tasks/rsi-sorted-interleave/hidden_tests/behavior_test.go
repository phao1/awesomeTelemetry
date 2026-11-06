package task

import (
    "reflect"
    "encoding/json"
    "testing"
)

func TestSortedInterleaveScenario01(t *testing.T) {
    arg0 := []int{1,3}
    arg1 := []int{2,4}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    if len(got) > 0 {
        saved := got[0]
        got[0]++
        mutated, _ := json.Marshal([]any{arg0, arg1})
        if string(before) != string(mutated) { t.Fatal("result aliases caller input") }
        got[0] = saved
    }
    want := []int{1,2,3,4}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-99d456b3b7041a21: got %#v; want %#v", got, want) }
}

func TestSortedInterleaveScenario02(t *testing.T) {
    arg0 := []int{1,1}
    arg1 := []int{1}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    if len(got) > 0 {
        saved := got[0]
        got[0]++
        mutated, _ := json.Marshal([]any{arg0, arg1})
        if string(before) != string(mutated) { t.Fatal("result aliases caller input") }
        got[0] = saved
    }
    want := []int{1,1,1}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-99d456b3b7041a21: got %#v; want %#v", got, want) }
}

func TestSortedInterleaveScenario03(t *testing.T) {
    arg0 := []int{}
    arg1 := []int{2}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    if len(got) > 0 {
        saved := got[0]
        got[0]++
        mutated, _ := json.Marshal([]any{arg0, arg1})
        if string(before) != string(mutated) { t.Fatal("result aliases caller input") }
        got[0] = saved
    }
    want := []int{2}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-99d456b3b7041a21: got %#v; want %#v", got, want) }
}

func TestSortedInterleaveScenario04(t *testing.T) {
    arg0 := []int{2}
    arg1 := []int{}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    if len(got) > 0 {
        saved := got[0]
        got[0]++
        mutated, _ := json.Marshal([]any{arg0, arg1})
        if string(before) != string(mutated) { t.Fatal("result aliases caller input") }
        got[0] = saved
    }
    want := []int{2}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-99d456b3b7041a21: got %#v; want %#v", got, want) }
}

func TestSortedInterleaveScenario05(t *testing.T) {
    arg0 := []int{}
    arg1 := []int{}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    if len(got) > 0 {
        saved := got[0]
        got[0]++
        mutated, _ := json.Marshal([]any{arg0, arg1})
        if string(before) != string(mutated) { t.Fatal("result aliases caller input") }
        got[0] = saved
    }
    want := []int{}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-99d456b3b7041a21: got %#v; want %#v", got, want) }
}

func TestSortedInterleaveScenario06(t *testing.T) {
    arg0 := []int{-3,0}
    arg1 := []int{-2,0,5}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    if len(got) > 0 {
        saved := got[0]
        got[0]++
        mutated, _ := json.Marshal([]any{arg0, arg1})
        if string(before) != string(mutated) { t.Fatal("result aliases caller input") }
        got[0] = saved
    }
    want := []int{-3,-2,0,0,5}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-99d456b3b7041a21: got %#v; want %#v", got, want) }
}

func TestSortedInterleaveScenario07(t *testing.T) {
    arg0 := []int{1,2,3}
    arg1 := []int{4}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    if len(got) > 0 {
        saved := got[0]
        got[0]++
        mutated, _ := json.Marshal([]any{arg0, arg1})
        if string(before) != string(mutated) { t.Fatal("result aliases caller input") }
        got[0] = saved
    }
    want := []int{1,2,3,4}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-99d456b3b7041a21: got %#v; want %#v", got, want) }
}

