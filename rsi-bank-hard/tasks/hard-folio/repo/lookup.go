package workspace
import (
 "fmt"
 "strings"
)
func(a *Archive) follow(owner,target string,seen map[string]bool)(Entry,error){
 if seen[owner]{return Entry{},fmt.Errorf("link cycle")}
 seen[owner]=true
 result,err:=a.resolve(target,seen)
 delete(seen,owner)
 return result,err
}
func(a *Archive) resolve(name string,seen map[string]bool)(Entry,error){
 if name==""{return Entry{Path:"",Kind:"dir",Mode:0755},nil}
 parts:=strings.Split(name,"/")
 for i:=range parts{
  prefix:=strings.Join(parts[:i+1],"/")
  e,ok:=a.nodes[prefix]
  if !ok{return Entry{},fmt.Errorf("missing")}
  if e.Kind=="symlink"{
   destination,err:=linkDestination(prefix,e.Target)
   if err!=nil{return Entry{},err}
   target,err:=a.follow(prefix,destination,seen)
   if err!=nil{return Entry{},err}
   if i+1<len(parts){
    if target.Kind!="dir"{return Entry{},fmt.Errorf("not directory")}
    return a.resolve(child(target.Path,strings.Join(parts[i+1:],"/")),seen)
   }
   return target,nil
  }
  if i+1<len(parts)&&e.Kind!="dir"{return Entry{},fmt.Errorf("not directory")}
  if i==len(parts)-1{
   if e.Kind=="hardlink"{return a.follow(prefix,e.Target,seen)}
   return duplicate(e),nil
  }
 }
 return Entry{},fmt.Errorf("missing")
}
func(a *Archive) Read(name string)([]byte,error){
 p,err:=clean(name);if err!=nil{return nil,err}
 e,err:=a.resolve(p,make(map[string]bool));if err!=nil{return nil,err}
 if e.Kind!="file"{return nil,fmt.Errorf("not file")}
 return append([]byte(nil),e.Body...),nil
}
func(a *Archive) Stat(name string)(Entry,error){p,err:=clean(name);if err!=nil{return Entry{},err};e,ok:=a.nodes[p];if !ok{return Entry{},fmt.Errorf("missing")};return duplicate(e),nil}
