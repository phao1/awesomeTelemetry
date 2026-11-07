package workspace
import "fmt"
func(a *Archive) ensureParents(name string)error{
 var pending []string
 for p:=parent(name);p!="";p=parent(p){
  if e,ok:=a.nodes[p];ok{if e.Kind!="dir"{return fmt.Errorf("parent")};break}
  pending=append(pending,p)
 }
 for i:=len(pending)-1;i>=0;i--{p:=pending[i];a.nodes[p]=Entry{Path:p,Kind:"dir",Mode:0755}}
 return nil
}
func(a *Archive) checkLeaf(name string,kind string)error{
 old,ok:=a.nodes[name]
 if !ok{return nil}
 if old.Kind=="dir"&&kind!="dir"{
  for p:=range a.nodes{if p!=name&&descendant(name,p){return fmt.Errorf("nonempty directory")}}
 }
 if old.Kind!="dir"&&kind=="dir"{return fmt.Errorf("type")}
 return nil
}
