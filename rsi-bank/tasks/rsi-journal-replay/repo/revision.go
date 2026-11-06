package task

func accept(next, old Event, exists bool) bool {
    return !exists || next.Revision >= old.Revision
}
