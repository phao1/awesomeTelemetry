package workspace
import (
 "fmt"
 "path"
 "strings"
)
func clean(name string)(string,error){
 if strings.HasPrefix(name,"/")||strings.Contains(name,"\\")||strings.ContainsRune(name,0){return "",fmt.Errorf("path")}
 value:=path.Clean(name)
 if value==".."||strings.HasPrefix(value,"../"){return "",fmt.Errorf("escape")}
 if value=="."{return "",nil}
 return value,nil
}
func parent(name string)string{value:=path.Dir(name);if value=="."{return ""};return value}
func child(base,name string)string{if base==""{return name};return base+"/"+name}
