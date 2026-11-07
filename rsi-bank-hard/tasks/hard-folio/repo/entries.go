package workspace
type Entry struct { Path,Kind,Target string; Body []byte; Mode int }
type Archive struct { nodes map[string]Entry }
func NewArchive()*Archive{return &Archive{nodes:make(map[string]Entry)}}
func duplicate(e Entry)Entry{e.Body=append([]byte(nil),e.Body...);return e}
func (a *Archive) Clone()*Archive{out:=NewArchive();for p,e:=range a.nodes{out.nodes[p]=duplicate(e)};return out}
