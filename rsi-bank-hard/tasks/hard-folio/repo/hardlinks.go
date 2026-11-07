package workspace
func(a *Archive) materialize(e Entry)(Entry,error){
 if e.Kind=="hardlink"{target,err:=clean(e.Target);if err!=nil{return Entry{},err};if _,err=a.Read(target);err!=nil{return Entry{},err};e.Target=target}
 return e,nil
}
