package task

import (
    "reflect"
    "encoding/json"
    "testing"
)

func TestDependencyWavesScenario01(t *testing.T) {
    arg0 := map[string][]string{"azalea-job":{"z"}}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := [][]string{{"z"},{"azalea-job"}}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-360990fb55098a68: got %#v; want %#v", got, want) }
}

func TestDependencyWavesScenario02(t *testing.T) {
    arg0 := map[string][]string{}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := [][]string{}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-360990fb55098a68: got %#v; want %#v", got, want) }
}

func TestDependencyWavesScenario03(t *testing.T) {
    arg0 := map[string][]string{"a":{"a"}}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := [][]string(nil)
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-360990fb55098a68: got %#v; want %#v", got, want) }
}

func TestDependencyWavesScenario04(t *testing.T) {
    arg0 := map[string][]string{"a":{"b"},"b":{"a"}}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := [][]string(nil)
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-360990fb55098a68: got %#v; want %#v", got, want) }
}

func TestDependencyWavesScenario05(t *testing.T) {
    arg0 := map[string][]string{"a":{},"b":{},"c":{"a","b"}}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := [][]string{{"a","b"},{"c"}}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-360990fb55098a68: got %#v; want %#v", got, want) }
}

func TestDependencyWavesScenario06(t *testing.T) {
    arg0 := map[string][]string{"a":{},"b":{"x"},"x":{"b"}}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := [][]string(nil)
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-360990fb55098a68: got %#v; want %#v", got, want) }
}

func TestDependencyWavesScenario07(t *testing.T) {
    arg0 := map[string][]string{"a":{"b","b"}}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := [][]string{{"b"},{"a"}}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-360990fb55098a68: got %#v; want %#v", got, want) }
}

func TestDependencyWavesScenario08(t *testing.T) {
    arg0 := map[string][]string{"a":{},"b":{"a"},"c":{"b"}}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := [][]string{{"a"},{"b"},{"c"}}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-360990fb55098a68: got %#v; want %#v", got, want) }
}

