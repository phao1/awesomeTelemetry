package task

 type Event struct { ID, Key string; Revision int; Value string; Deleted bool }

func Evaluate(events []Event) map[string]string {
    records := map[string]Event{}
    for _, e := range events {
        old, exists := records[e.Key]
        if accept(e, old, exists) {
            if e.Deleted { delete(records, e.Key) } else { records[e.Key] = e }
        }
    }
    live := map[string]string{}
    for key, e := range records { live[key] = e.Value }
    return live
}
