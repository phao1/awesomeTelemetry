package task

import (
    "reflect"
    "encoding/json"
    "testing"
)

func TestRollingLimiterScenario01(t *testing.T) {
    arg0 := []int{0,1,2,5}
    arg1 := 5
    arg2 := 2
    before, _ := json.Marshal([]any{arg0, arg1, arg2})
    got := Evaluate(arg0, arg1, arg2)
    after, _ := json.Marshal([]any{arg0, arg1, arg2})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []bool{true,true,false,true}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2686cafac201e6bd: got %#v; want %#v", got, want) }
}

func TestRollingLimiterScenario02(t *testing.T) {
    arg0 := []int{0,0,0}
    arg1 := 5
    arg2 := 2
    before, _ := json.Marshal([]any{arg0, arg1, arg2})
    got := Evaluate(arg0, arg1, arg2)
    after, _ := json.Marshal([]any{arg0, arg1, arg2})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []bool{true,true,false}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2686cafac201e6bd: got %#v; want %#v", got, want) }
}

func TestRollingLimiterScenario03(t *testing.T) {
    arg0 := []int{0,1}
    arg1 := 5
    arg2 := 0
    before, _ := json.Marshal([]any{arg0, arg1, arg2})
    got := Evaluate(arg0, arg1, arg2)
    after, _ := json.Marshal([]any{arg0, arg1, arg2})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []bool{false,false}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2686cafac201e6bd: got %#v; want %#v", got, want) }
}

func TestRollingLimiterScenario04(t *testing.T) {
    arg0 := []int{0,4,5,9}
    arg1 := 5
    arg2 := 1
    before, _ := json.Marshal([]any{arg0, arg1, arg2})
    got := Evaluate(arg0, arg1, arg2)
    after, _ := json.Marshal([]any{arg0, arg1, arg2})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []bool{true,false,true,false}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2686cafac201e6bd: got %#v; want %#v", got, want) }
}

func TestRollingLimiterScenario05(t *testing.T) {
    arg0 := []int{}
    arg1 := 5
    arg2 := 2
    before, _ := json.Marshal([]any{arg0, arg1, arg2})
    got := Evaluate(arg0, arg1, arg2)
    after, _ := json.Marshal([]any{arg0, arg1, arg2})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []bool{}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2686cafac201e6bd: got %#v; want %#v", got, want) }
}

func TestRollingLimiterScenario06(t *testing.T) {
    arg0 := []int{-5,0}
    arg1 := 5
    arg2 := 1
    before, _ := json.Marshal([]any{arg0, arg1, arg2})
    got := Evaluate(arg0, arg1, arg2)
    after, _ := json.Marshal([]any{arg0, arg1, arg2})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []bool{true,true}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2686cafac201e6bd: got %#v; want %#v", got, want) }
}

func TestRollingLimiterScenario07(t *testing.T) {
    arg0 := []int{0,10,11}
    arg1 := 5
    arg2 := 2
    before, _ := json.Marshal([]any{arg0, arg1, arg2})
    got := Evaluate(arg0, arg1, arg2)
    after, _ := json.Marshal([]any{arg0, arg1, arg2})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []bool{true,true,true}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2686cafac201e6bd: got %#v; want %#v", got, want) }
}

func TestRollingLimiterScenario08(t *testing.T) {
    arg0 := []int{0,1,6,6,6}
    arg1 := 5
    arg2 := 2
    before, _ := json.Marshal([]any{arg0, arg1, arg2})
    got := Evaluate(arg0, arg1, arg2)
    after, _ := json.Marshal([]any{arg0, arg1, arg2})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := []bool{true,true,true,true,false}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2686cafac201e6bd: got %#v; want %#v", got, want) }
}

