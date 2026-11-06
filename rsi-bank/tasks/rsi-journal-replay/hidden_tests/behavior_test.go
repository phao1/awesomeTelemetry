package task

import (
    "reflect"
    "encoding/json"
    "testing"
)

func TestJournalReplayScenario01(t *testing.T) {
    arg0 := []Event{{"foxglove-event","a",1,"first",false},{"foxglove-event","a",2,"duplicate",false}}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]string{"a":"first"}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-95c84f2c10d9e69d: got %#v; want %#v", got, want) }
}

func TestJournalReplayScenario02(t *testing.T) {
    arg0 := []Event{{"1","a",2,"new",false},{"2","a",1,"old",false}}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]string{"a":"new"}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-95c84f2c10d9e69d: got %#v; want %#v", got, want) }
}

func TestJournalReplayScenario03(t *testing.T) {
    arg0 := []Event{{"1","a",2,"",true},{"2","a",1,"old",false}}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]string{}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-95c84f2c10d9e69d: got %#v; want %#v", got, want) }
}

func TestJournalReplayScenario04(t *testing.T) {
    arg0 := []Event{{"1","a",1,"first",false},{"2","a",1,"second",false}}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]string{"a":"first"}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-95c84f2c10d9e69d: got %#v; want %#v", got, want) }
}

func TestJournalReplayScenario05(t *testing.T) {
    arg0 := []Event{}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]string{}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-95c84f2c10d9e69d: got %#v; want %#v", got, want) }
}

func TestJournalReplayScenario06(t *testing.T) {
    arg0 := []Event{{"1","a",1,"",true},{"2","a",2,"reborn",false}}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]string{"a":"reborn"}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-95c84f2c10d9e69d: got %#v; want %#v", got, want) }
}

func TestJournalReplayScenario07(t *testing.T) {
    arg0 := []Event{{"1","a",0,"A",false},{"1","b",1,"B",false}}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]string{"a":"A"}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-95c84f2c10d9e69d: got %#v; want %#v", got, want) }
}

func TestJournalReplayScenario08(t *testing.T) {
    arg0 := []Event{{"1","a",-1,"negative",false}}
    before, _ := json.Marshal([]any{arg0})
    got := Evaluate(arg0)
    after, _ := json.Marshal([]any{arg0})
    if string(before) != string(after) { t.Fatal("caller-owned input changed") }
    want := map[string]string{"a":"negative"}
    if !reflect.DeepEqual(got, want) { t.Fatalf("regression-95c84f2c10d9e69d: got %#v; want %#v", got, want) }
}

