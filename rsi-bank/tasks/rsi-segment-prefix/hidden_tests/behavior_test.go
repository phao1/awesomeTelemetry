package task

import (
    "reflect"
    "encoding/json"
    "testing"
)

func TestSegmentPrefixScenario01(t *testing.T) {
    arg0 := "/magnolia-folder"
    arg1 := "/magnolia-folder-sibling"
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := false
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-17d4d009e1295efa: got %#v; want %#v", got, want) }
}

func TestSegmentPrefixScenario02(t *testing.T) {
    arg0 := "/a"
    arg1 := "/a/b"
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := true
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-17d4d009e1295efa: got %#v; want %#v", got, want) }
}

func TestSegmentPrefixScenario03(t *testing.T) {
    arg0 := "/a"
    arg1 := "/a/../b"
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := false
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-17d4d009e1295efa: got %#v; want %#v", got, want) }
}

func TestSegmentPrefixScenario04(t *testing.T) {
    arg0 := "/a//b"
    arg1 := "a/b/./c"
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := true
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-17d4d009e1295efa: got %#v; want %#v", got, want) }
}

func TestSegmentPrefixScenario05(t *testing.T) {
    arg0 := "/"
    arg1 := "/any"
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := true
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-17d4d009e1295efa: got %#v; want %#v", got, want) }
}

func TestSegmentPrefixScenario06(t *testing.T) {
    arg0 := "/a/b"
    arg1 := "/a"
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := false
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-17d4d009e1295efa: got %#v; want %#v", got, want) }
}

func TestSegmentPrefixScenario07(t *testing.T) {
    arg0 := "/A"
    arg1 := "/a"
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := false
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-17d4d009e1295efa: got %#v; want %#v", got, want) }
}

func TestSegmentPrefixScenario08(t *testing.T) {
    arg0 := "/a"
    arg1 := "/a/%2e%2e"
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := true
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-17d4d009e1295efa: got %#v; want %#v", got, want) }
}

func TestSegmentPrefixScenario09(t *testing.T) {
    arg0 := "/a"
    arg1 := "../../a"
    before, _ := json.Marshal([]any{arg0, arg1})
    got := Evaluate(arg0, arg1)
    after, _ := json.Marshal([]any{arg0, arg1})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := true
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-17d4d009e1295efa: got %#v; want %#v", got, want) }
}

