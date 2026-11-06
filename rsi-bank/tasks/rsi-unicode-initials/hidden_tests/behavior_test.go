package task

import (
    "reflect"
    "encoding/json"
    "testing"
)

func TestUnicodeInitialsScenario01(t *testing.T) {
    arg0 := "Camellia Harbor"
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := "CH"
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2c19242d6a8e9972: got %#v; want %#v", got, want) }
}

func TestUnicodeInitialsScenario02(t *testing.T) {
    arg0 := "张 伟"
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := "张伟"
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2c19242d6a8e9972: got %#v; want %#v", got, want) }
}

func TestUnicodeInitialsScenario03(t *testing.T) {
    arg0 := "Émile Zola"
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := "ÉZ"
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2c19242d6a8e9972: got %#v; want %#v", got, want) }
}

func TestUnicodeInitialsScenario04(t *testing.T) {
    arg0 := "  Ada\tLovelace\n"
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := "AL"
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2c19242d6a8e9972: got %#v; want %#v", got, want) }
}

func TestUnicodeInitialsScenario05(t *testing.T) {
    arg0 := ""
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := ""
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2c19242d6a8e9972: got %#v; want %#v", got, want) }
}

func TestUnicodeInitialsScenario06(t *testing.T) {
    arg0 := "   "
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := ""
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2c19242d6a8e9972: got %#v; want %#v", got, want) }
}

func TestUnicodeInitialsScenario07(t *testing.T) {
    arg0 := "🦊 Team"
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := "🦊T"
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2c19242d6a8e9972: got %#v; want %#v", got, want) }
}

func TestUnicodeInitialsScenario08(t *testing.T) {
    arg0 := "Single"
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := "S"
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-2c19242d6a8e9972: got %#v; want %#v", got, want) }
}

