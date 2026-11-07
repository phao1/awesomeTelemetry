package workspace
import "reflect"
type Change struct{Path,Kind string}
func Difference(before,after *Archive)[]Change{
 names:=make(map[string]bool);for p:=range before.nodes{names[p]=true};for p:=range after.nodes{names[p]=true}
 var paths []string;for p:=range names{paths=append(paths,p)};ordered(paths)
 var out []Change
 for _,p:=range paths{
  a,aok:=before.nodes[p];b,bok:=after.nodes[p]
  if !aok{out=append(out,Change{p,"add"})}else if !bok{out=append(out,Change{p,"remove"})}else if !reflect.DeepEqual(a,b){out=append(out,Change{p,"modify"})}
 }
 return out
}
