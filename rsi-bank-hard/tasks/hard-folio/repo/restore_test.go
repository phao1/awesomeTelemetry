package workspace
import (
 "testing"
 "fmt"
 "reflect"
)
func TestUserReplay(t *testing.T){
 a:=NewArchive()
 err:=a.Replay([]byte(`[{"Path":"docs/title","Kind":"file","Body":"b2xk","Mode":420},{"Path":"docs/link","Kind":"symlink","Target":"title","Mode":511},{"Path":"copy","Kind":"hardlink","Target":"docs/title","Mode":420},{"Path":"docs2/keep","Kind":"file","Body":"a2VlcA==","Mode":420}]`))
 if err!=nil{t.Fatal(err)}
 fmt.Println(a.Read("docs/link"))
 _=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("new"),Mode:0644},{Path:"docs",Kind:"remove"}})
 fmt.Println(a.Read("copy"));fmt.Println(a.Read("docs2/keep"))
 _=a.Apply([]Entry{{Path:"Z",Kind:"file",Body:[]byte("upper")},{Path:"a",Kind:"file",Body:[]byte("lower")}})
 fmt.Println(a.Entries())
 if len(a.Entries())==0{t.Fatal("empty")}
}
func TestArchiveWorkflow0(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first0"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first0"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first0"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow1(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first1"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first1"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first1"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow2(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first2"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first2"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first2"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow3(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first3"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first3"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first3"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow4(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first4"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first4"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first4"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow5(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first5"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first5"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first5"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow6(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first6"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first6"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first6"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow7(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first7"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first7"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first7"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow8(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first8"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first8"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first8"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow9(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first9"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first9"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first9"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow10(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first10"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first10"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first10"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow11(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first11"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first11"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first11"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow12(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first12"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first12"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first12"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow13(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first13"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first13"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first13"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow14(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first14"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first14"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first14"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow15(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first15"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first15"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first15"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow16(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first16"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first16"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first16"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow17(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first17"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first17"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first17"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow18(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first18"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first18"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first18"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow19(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first19"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first19"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first19"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow20(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first20"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first20"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first20"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow21(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first21"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first21"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first21"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow22(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first22"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first22"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first22"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow23(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first23"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first23"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first23"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow24(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first24"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first24"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first24"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow25(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first25"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first25"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first25"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow26(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first26"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first26"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first26"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow27(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first27"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first27"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first27"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow28(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first28"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first28"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first28"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow29(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first29"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first29"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first29"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow30(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first30"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first30"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first30"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow31(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first31"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first31"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first31"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow32(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first32"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first32"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first32"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow33(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first33"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first33"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first33"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow34(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first34"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first34"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first34"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow35(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first35"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first35"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first35"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow36(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first36"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first36"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first36"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow37(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first37"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first37"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first37"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow38(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first38"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first38"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first38"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow39(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first39"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first39"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first39"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow40(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first40"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first40"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first40"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow41(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first41"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first41"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first41"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow42(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first42"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first42"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first42"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow43(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first43"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first43"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first43"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow44(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first44"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first44"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first44"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow45(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first45"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first45"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first45"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow46(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first46"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first46"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first46"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
func TestArchiveWorkflow47(t *testing.T){
 a:=NewArchive()
 initial:=[]Entry{
  {Path:"docs/a",Kind:"file",Body:[]byte("first47"),Mode:0644},
  {Path:"docs/b",Kind:"file",Body:[]byte("second"),Mode:0600},
  {Path:"link",Kind:"symlink",Target:"docs/a",Mode:0777},
 }
 if err:=a.Apply(initial);err!=nil{t.Fatal(err)}
 body,err:=a.Read("link")
 if err!=nil||string(body)!="first47"{t.Fatal(body,err)}
 body[0]='X'
 again,err:=a.Read("docs/a")
 if err!=nil||string(again)!="first47"{t.Fatal("read copy",err)}
 listing,err:=a.List("docs")
 if err!=nil||len(listing)!=2{t.Fatal(listing,err)}
 clone:=a.Clone()
 if clone.Digest()!=a.Digest(){t.Fatal("clone")}
 data,err:=a.Tar()
 if err!=nil{t.Fatal(err)}
 restored:=NewArchive()
 if err=restored.Import(data);err!=nil{t.Fatal(err)}
 if restored.Digest()!=a.Digest(){t.Fatal("roundtrip")}
 if changes:=Difference(a,restored);len(changes)!=0{t.Fatal(changes)}
 before:=a.Entries()
 if err=a.Apply([]Entry{{Path:"new",Kind:"file",Body:[]byte("x"),Mode:0644},{Path:"../escape",Kind:"file"}});err==nil{t.Fatal("escape")}
 if !reflect.DeepEqual(before,a.Entries()){t.Fatal("atomicity")}
 if err=a.Apply([]Entry{{Path:"docs/b",Kind:"remove"}});err!=nil{t.Fatal(err)}
 if _,err=a.Read("docs/b");err==nil{t.Fatal("remove")}
 if changes:=Difference(clone,a);len(changes)!=1||changes[0].Kind!="remove"{t.Fatal(changes)}
}
