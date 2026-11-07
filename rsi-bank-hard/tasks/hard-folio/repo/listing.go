package workspace
func(a *Archive) Entries()[]Entry{
 names:=make([]string,0,len(a.nodes));for p:=range a.nodes{names=append(names,p)};ordered(names)
 result:=make([]Entry,0,len(names));for _,p:=range names{result=append(result,duplicate(a.nodes[p]))};return result
}
func(a *Archive) List(directory string)([]Entry,error){
 base,err:=clean(directory);if err!=nil{return nil,err}
 out:=[]Entry{}
 for _,e:=range a.Entries(){if parent(e.Path)==base{out=append(out,e)}}
 return out,nil
}
