package workspace
import "fmt"
func(a *Archive) Apply(entries []Entry)error{
 next:=a.Clone()
 for _,raw:=range entries{
  e:=duplicate(raw)
  name,err:=clean(e.Path);if err!=nil{return err};if name==""{return fmt.Errorf("root entry")};e.Path=name
  if e.Kind=="remove"{for p:=range next.nodes{if descendant(name,p){delete(next.nodes,p)}};continue}
  if e.Kind!="file"&&e.Kind!="dir"&&e.Kind!="symlink"&&e.Kind!="hardlink"{return fmt.Errorf("kind")}
  if e.Mode<0||e.Mode>0777{return fmt.Errorf("mode")}
  if err=next.ensureParents(name);err!=nil{return err}
  if err=next.checkLeaf(name,e.Kind);err!=nil{return err}
  e,err=next.materialize(e);if err!=nil{return err}
  next.nodes[name]=e
 }
 a.nodes=next.nodes
 return nil
}
