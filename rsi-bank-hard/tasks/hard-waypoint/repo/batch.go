package workspace
import "reflect"
type Operation struct { Op string; Path string; From string; Value any }
func Apply(document any,operations []Operation) (any,error) {
 root:=document
 for _,op:=range operations {
  path,_:=pointer(op.Path)
  if op.Op=="test" {v,err:=lookup(root,path);if err!=nil{return nil,err};if reflect.DeepEqual(v,op.Value){continue}}
  var err error
  root,err=edit(root,path,op.Value,op.Op)
  if err!=nil{return nil,err}
 }
 return root,nil
}
