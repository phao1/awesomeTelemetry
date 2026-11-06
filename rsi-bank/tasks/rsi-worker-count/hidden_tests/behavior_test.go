package task

import (
    "reflect"
    "encoding/json"
    "testing"
)

func TestWorkerCountScenario01(t *testing.T) {
    arg0 := 7
    arg1 := 3
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := 3
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-b1394e4cc461ca2a: got %#v; want %#v", got, want) }
}

func TestWorkerCountScenario02(t *testing.T) {
    arg0 := 6
    arg1 := 3
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := 2
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-b1394e4cc461ca2a: got %#v; want %#v", got, want) }
}

func TestWorkerCountScenario03(t *testing.T) {
    arg0 := 0
    arg1 := 3
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := 0
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-b1394e4cc461ca2a: got %#v; want %#v", got, want) }
}

func TestWorkerCountScenario04(t *testing.T) {
    arg0 := 1
    arg1 := 9
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := 1
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-b1394e4cc461ca2a: got %#v; want %#v", got, want) }
}

func TestWorkerCountScenario05(t *testing.T) {
    arg0 := 9
    arg1 := 1
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := 9
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-b1394e4cc461ca2a: got %#v; want %#v", got, want) }
}

func TestWorkerCountScenario06(t *testing.T) {
    arg0 := int(^uint(0)>>1)
    arg1 := int(^uint(0)>>1)
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := 1
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-b1394e4cc461ca2a: got %#v; want %#v", got, want) }
}

func TestWorkerCountScenario07(t *testing.T) {
    arg0 := int(^uint(0)>>1)
    arg1 := 2
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := int(^uint(0)>>1)/2 + 1
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-b1394e4cc461ca2a: got %#v; want %#v", got, want) }
}

