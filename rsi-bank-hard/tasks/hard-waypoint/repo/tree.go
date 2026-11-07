package workspace
import "fmt"
func lookup(root any,path []string) (any,error) {
 value:=root
 for _,key:=range path {
  object,ok:=value.(map[string]any)
  if !ok { return nil,fmt.Errorf("object") }
  value=object[key]
 }
 return value,nil
}
func edit(root any,path []string,value any,mode string) (any,error) {
 if len(path)==0 {return value,nil}
 object,ok:=root.(map[string]any);if !ok{return nil,fmt.Errorf("object")}
 if len(path)==1 {if mode=="remove"{delete(object,path[0])}else{object[path[0]]=value};return object,nil}
 child,err:=edit(object[path[0]],path[1:],value,mode);if err!=nil{return nil,err};object[path[0]]=child;return object,nil
}
