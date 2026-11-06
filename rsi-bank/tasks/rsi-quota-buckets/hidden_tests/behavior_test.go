package task

import (
    "reflect"
    "encoding/json"
    "testing"
)

func TestQuotaBucketsScenario01(t *testing.T) {
    arg0 := map[string]int{"heather-tenant":5,"b":5}
    arg1 := []Op{{"reserve","heather-tenant","x",3},{"reserve","b","x",2}}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]int{"heather-tenant":2,"b":3}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-c0802038a588fa8d: got %#v; want %#v", got, want) }
}

func TestQuotaBucketsScenario02(t *testing.T) {
    arg0 := map[string]int{"a":5}
    arg1 := []Op{{"reserve","a","x",3},{"reserve","a","x",1},{"cancel","a","x",0},{"cancel","a","x",0}}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]int{"a":5}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-c0802038a588fa8d: got %#v; want %#v", got, want) }
}

func TestQuotaBucketsScenario03(t *testing.T) {
    arg0 := map[string]int{"a":5}
    arg1 := []Op{{"reserve","a","x",6},{"cancel","a","x",0}}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]int{"a":5}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-c0802038a588fa8d: got %#v; want %#v", got, want) }
}

func TestQuotaBucketsScenario04(t *testing.T) {
    arg0 := map[string]int{"a":5}
    arg1 := []Op{{"reserve","a","x",-1},{"reserve","none","x",1}}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]int{"a":5}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-c0802038a588fa8d: got %#v; want %#v", got, want) }
}

func TestQuotaBucketsScenario05(t *testing.T) {
    arg0 := map[string]int{"a":5}
    arg1 := []Op{{"reserve","a","x",5}}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]int{"a":0}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-c0802038a588fa8d: got %#v; want %#v", got, want) }
}

func TestQuotaBucketsScenario06(t *testing.T) {
    arg0 := map[string]int{"a":5}
    arg1 := []Op{{"reserve","a","x",2},{"touch","a","x",0}}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]int{"a":3}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-c0802038a588fa8d: got %#v; want %#v", got, want) }
}

func TestQuotaBucketsScenario07(t *testing.T) {
    arg0 := map[string]int{"a":5,"b":5}
    arg1 := []Op{{"reserve","a","x",2},{"cancel","b","x",0}}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]int{"a":3,"b":5}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-c0802038a588fa8d: got %#v; want %#v", got, want) }
}

func TestQuotaBucketsScenario08(t *testing.T) {
    arg0 := map[string]int{}
    arg1 := []Op{}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]int{}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-c0802038a588fa8d: got %#v; want %#v", got, want) }
}

func TestQuotaBucketsScenario09(t *testing.T) {
    arg0 := map[string]int{"a":5}
    arg1 := []Op{{"reserve","a","x",0}}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]int{"a":5}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-c0802038a588fa8d: got %#v; want %#v", got, want) }
}

func TestQuotaBucketsScenario10(t *testing.T) {
    arg0 := map[string]int{"a":5}
    arg1 := []Op{{"reserve","a","x",2},{"cancel","a","x",0},{"reserve","a","x",4}}
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]int{"a":1}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-c0802038a588fa8d: got %#v; want %#v", got, want) }
}

func TestQuotaBucketsScenario11(t *testing.T) {
    limits := map[string]int{"a\x00b":5,"a":5}
    ops := []Op{{"reserve","a\x00b","c",2},{"reserve","a","b\x00c",3}}
    before, _ := json.Marshal([]any{limits, ops})
    got := Evaluate(limits, ops)
    after, _ := json.Marshal([]any{limits, ops})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]int{"a\x00b":3,"a":2}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-c0802038a588fa8d: got %#v; want %#v", got, want) }
}
