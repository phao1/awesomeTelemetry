package checks
import (
"testing"
. "workspace"
"reflect"
"archive/tar"
"bytes"
"io"
)
func TestFolioInteraction000(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("old0"),Mode:0644},{Path:"docs/link",Kind:"symlink",Target:"title",Mode:0777},{Path:"copy",Kind:"hardlink",Target:"docs/title",Mode:0600},{Path:"docs2/keep",Kind:"file",Body:[]byte("keep"),Mode:0644}});if err!=nil{t.Fatal(err)}
body,err:=a.Read("docs/link");if err!=nil||string(body)!="old0"{t.Fatal(body,err)}
err=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("new"),Mode:0644},{Path:"docs",Kind:"remove"}});if err!=nil{t.Fatal(err)}
body,err=a.Read("copy");if err!=nil||string(body)!="old0"{t.Fatal(body,err)}
body,err=a.Read("docs2/keep");if err!=nil||string(body)!="keep"{t.Fatal(body,err)}
entry,err:=a.Stat("copy");if err!=nil||entry.Kind!="file"||entry.Target!=""||entry.Mode!=0600{t.Fatal(entry,err)}

}
func TestFolioInteraction001(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("old1"),Mode:0644},{Path:"docs/link",Kind:"symlink",Target:"title",Mode:0777},{Path:"copy",Kind:"hardlink",Target:"docs/title",Mode:0600},{Path:"docs2/keep",Kind:"file",Body:[]byte("keep"),Mode:0644}});if err!=nil{t.Fatal(err)}
body,err:=a.Read("docs/link");if err!=nil||string(body)!="old1"{t.Fatal(body,err)}
err=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("new"),Mode:0644},{Path:"docs",Kind:"remove"}});if err!=nil{t.Fatal(err)}
body,err=a.Read("copy");if err!=nil||string(body)!="old1"{t.Fatal(body,err)}
body,err=a.Read("docs2/keep");if err!=nil||string(body)!="keep"{t.Fatal(body,err)}
entry,err:=a.Stat("copy");if err!=nil||entry.Kind!="file"||entry.Target!=""||entry.Mode!=0600{t.Fatal(entry,err)}

}
func TestFolioInteraction002(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("old2"),Mode:0644},{Path:"docs/link",Kind:"symlink",Target:"title",Mode:0777},{Path:"copy",Kind:"hardlink",Target:"docs/title",Mode:0600},{Path:"docs2/keep",Kind:"file",Body:[]byte("keep"),Mode:0644}});if err!=nil{t.Fatal(err)}
body,err:=a.Read("docs/link");if err!=nil||string(body)!="old2"{t.Fatal(body,err)}
err=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("new"),Mode:0644},{Path:"docs",Kind:"remove"}});if err!=nil{t.Fatal(err)}
body,err=a.Read("copy");if err!=nil||string(body)!="old2"{t.Fatal(body,err)}
body,err=a.Read("docs2/keep");if err!=nil||string(body)!="keep"{t.Fatal(body,err)}
entry,err:=a.Stat("copy");if err!=nil||entry.Kind!="file"||entry.Target!=""||entry.Mode!=0600{t.Fatal(entry,err)}

}
func TestFolioInteraction003(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("old3"),Mode:0644},{Path:"docs/link",Kind:"symlink",Target:"title",Mode:0777},{Path:"copy",Kind:"hardlink",Target:"docs/title",Mode:0600},{Path:"docs2/keep",Kind:"file",Body:[]byte("keep"),Mode:0644}});if err!=nil{t.Fatal(err)}
body,err:=a.Read("docs/link");if err!=nil||string(body)!="old3"{t.Fatal(body,err)}
err=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("new"),Mode:0644},{Path:"docs",Kind:"remove"}});if err!=nil{t.Fatal(err)}
body,err=a.Read("copy");if err!=nil||string(body)!="old3"{t.Fatal(body,err)}
body,err=a.Read("docs2/keep");if err!=nil||string(body)!="keep"{t.Fatal(body,err)}
entry,err:=a.Stat("copy");if err!=nil||entry.Kind!="file"||entry.Target!=""||entry.Mode!=0600{t.Fatal(entry,err)}

}
func TestFolioInteraction004(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("old4"),Mode:0644},{Path:"docs/link",Kind:"symlink",Target:"title",Mode:0777},{Path:"copy",Kind:"hardlink",Target:"docs/title",Mode:0600},{Path:"docs2/keep",Kind:"file",Body:[]byte("keep"),Mode:0644}});if err!=nil{t.Fatal(err)}
body,err:=a.Read("docs/link");if err!=nil||string(body)!="old4"{t.Fatal(body,err)}
err=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("new"),Mode:0644},{Path:"docs",Kind:"remove"}});if err!=nil{t.Fatal(err)}
body,err=a.Read("copy");if err!=nil||string(body)!="old4"{t.Fatal(body,err)}
body,err=a.Read("docs2/keep");if err!=nil||string(body)!="keep"{t.Fatal(body,err)}
entry,err:=a.Stat("copy");if err!=nil||entry.Kind!="file"||entry.Target!=""||entry.Mode!=0600{t.Fatal(entry,err)}

}
func TestFolioInteraction005(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("old5"),Mode:0644},{Path:"docs/link",Kind:"symlink",Target:"title",Mode:0777},{Path:"copy",Kind:"hardlink",Target:"docs/title",Mode:0600},{Path:"docs2/keep",Kind:"file",Body:[]byte("keep"),Mode:0644}});if err!=nil{t.Fatal(err)}
body,err:=a.Read("docs/link");if err!=nil||string(body)!="old5"{t.Fatal(body,err)}
err=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("new"),Mode:0644},{Path:"docs",Kind:"remove"}});if err!=nil{t.Fatal(err)}
body,err=a.Read("copy");if err!=nil||string(body)!="old5"{t.Fatal(body,err)}
body,err=a.Read("docs2/keep");if err!=nil||string(body)!="keep"{t.Fatal(body,err)}
entry,err:=a.Stat("copy");if err!=nil||entry.Kind!="file"||entry.Target!=""||entry.Mode!=0600{t.Fatal(entry,err)}

}
func TestFolioInteraction006(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("old6"),Mode:0644},{Path:"docs/link",Kind:"symlink",Target:"title",Mode:0777},{Path:"copy",Kind:"hardlink",Target:"docs/title",Mode:0600},{Path:"docs2/keep",Kind:"file",Body:[]byte("keep"),Mode:0644}});if err!=nil{t.Fatal(err)}
body,err:=a.Read("docs/link");if err!=nil||string(body)!="old6"{t.Fatal(body,err)}
err=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("new"),Mode:0644},{Path:"docs",Kind:"remove"}});if err!=nil{t.Fatal(err)}
body,err=a.Read("copy");if err!=nil||string(body)!="old6"{t.Fatal(body,err)}
body,err=a.Read("docs2/keep");if err!=nil||string(body)!="keep"{t.Fatal(body,err)}
entry,err:=a.Stat("copy");if err!=nil||entry.Kind!="file"||entry.Target!=""||entry.Mode!=0600{t.Fatal(entry,err)}

}
func TestFolioInteraction007(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("old7"),Mode:0644},{Path:"docs/link",Kind:"symlink",Target:"title",Mode:0777},{Path:"copy",Kind:"hardlink",Target:"docs/title",Mode:0600},{Path:"docs2/keep",Kind:"file",Body:[]byte("keep"),Mode:0644}});if err!=nil{t.Fatal(err)}
body,err:=a.Read("docs/link");if err!=nil||string(body)!="old7"{t.Fatal(body,err)}
err=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("new"),Mode:0644},{Path:"docs",Kind:"remove"}});if err!=nil{t.Fatal(err)}
body,err=a.Read("copy");if err!=nil||string(body)!="old7"{t.Fatal(body,err)}
body,err=a.Read("docs2/keep");if err!=nil||string(body)!="keep"{t.Fatal(body,err)}
entry,err:=a.Stat("copy");if err!=nil||entry.Kind!="file"||entry.Target!=""||entry.Mode!=0600{t.Fatal(entry,err)}

}
func TestFolioInteraction008(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("old8"),Mode:0644},{Path:"docs/link",Kind:"symlink",Target:"title",Mode:0777},{Path:"copy",Kind:"hardlink",Target:"docs/title",Mode:0600},{Path:"docs2/keep",Kind:"file",Body:[]byte("keep"),Mode:0644}});if err!=nil{t.Fatal(err)}
body,err:=a.Read("docs/link");if err!=nil||string(body)!="old8"{t.Fatal(body,err)}
err=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("new"),Mode:0644},{Path:"docs",Kind:"remove"}});if err!=nil{t.Fatal(err)}
body,err=a.Read("copy");if err!=nil||string(body)!="old8"{t.Fatal(body,err)}
body,err=a.Read("docs2/keep");if err!=nil||string(body)!="keep"{t.Fatal(body,err)}
entry,err:=a.Stat("copy");if err!=nil||entry.Kind!="file"||entry.Target!=""||entry.Mode!=0600{t.Fatal(entry,err)}

}
func TestFolioInteraction009(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("old9"),Mode:0644},{Path:"docs/link",Kind:"symlink",Target:"title",Mode:0777},{Path:"copy",Kind:"hardlink",Target:"docs/title",Mode:0600},{Path:"docs2/keep",Kind:"file",Body:[]byte("keep"),Mode:0644}});if err!=nil{t.Fatal(err)}
body,err:=a.Read("docs/link");if err!=nil||string(body)!="old9"{t.Fatal(body,err)}
err=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("new"),Mode:0644},{Path:"docs",Kind:"remove"}});if err!=nil{t.Fatal(err)}
body,err=a.Read("copy");if err!=nil||string(body)!="old9"{t.Fatal(body,err)}
body,err=a.Read("docs2/keep");if err!=nil||string(body)!="keep"{t.Fatal(body,err)}
entry,err:=a.Stat("copy");if err!=nil||entry.Kind!="file"||entry.Target!=""||entry.Mode!=0600{t.Fatal(entry,err)}

}
func TestFolioInteraction010(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("old10"),Mode:0644},{Path:"docs/link",Kind:"symlink",Target:"title",Mode:0777},{Path:"copy",Kind:"hardlink",Target:"docs/title",Mode:0600},{Path:"docs2/keep",Kind:"file",Body:[]byte("keep"),Mode:0644}});if err!=nil{t.Fatal(err)}
body,err:=a.Read("docs/link");if err!=nil||string(body)!="old10"{t.Fatal(body,err)}
err=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("new"),Mode:0644},{Path:"docs",Kind:"remove"}});if err!=nil{t.Fatal(err)}
body,err=a.Read("copy");if err!=nil||string(body)!="old10"{t.Fatal(body,err)}
body,err=a.Read("docs2/keep");if err!=nil||string(body)!="keep"{t.Fatal(body,err)}
entry,err:=a.Stat("copy");if err!=nil||entry.Kind!="file"||entry.Target!=""||entry.Mode!=0600{t.Fatal(entry,err)}

}
func TestFolioInteraction011(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("old11"),Mode:0644},{Path:"docs/link",Kind:"symlink",Target:"title",Mode:0777},{Path:"copy",Kind:"hardlink",Target:"docs/title",Mode:0600},{Path:"docs2/keep",Kind:"file",Body:[]byte("keep"),Mode:0644}});if err!=nil{t.Fatal(err)}
body,err:=a.Read("docs/link");if err!=nil||string(body)!="old11"{t.Fatal(body,err)}
err=a.Apply([]Entry{{Path:"docs/title",Kind:"file",Body:[]byte("new"),Mode:0644},{Path:"docs",Kind:"remove"}});if err!=nil{t.Fatal(err)}
body,err=a.Read("copy");if err!=nil||string(body)!="old11"{t.Fatal(body,err)}
body,err=a.Read("docs2/keep");if err!=nil||string(body)!="keep"{t.Fatal(body,err)}
entry,err:=a.Stat("copy");if err!=nil||entry.Kind!="file"||entry.Target!=""||entry.Mode!=0600{t.Fatal(entry,err)}

}
func TestFolioInteraction012(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();base:="a";err:=a.Apply([]Entry{{Path:base+"/x",Kind:"file",Body:[]byte("x")},{Path:base+"2/x",Kind:"file",Body:[]byte("keep")}});if err!=nil{t.Fatal(err)};if err=a.Apply([]Entry{{Path:base,Kind:"remove"}});err!=nil{t.Fatal(err)};v,err:=a.Read(base+"2/x");if err!=nil||string(v)!="keep"{t.Fatal(v,err)};if _,err=a.Read(base+"/x");err==nil{t.Fatal("descendant survived")}

}
func TestFolioInteraction013(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();base:="docs";err:=a.Apply([]Entry{{Path:base+"/x",Kind:"file",Body:[]byte("x")},{Path:base+"2/x",Kind:"file",Body:[]byte("keep")}});if err!=nil{t.Fatal(err)};if err=a.Apply([]Entry{{Path:base,Kind:"remove"}});err!=nil{t.Fatal(err)};v,err:=a.Read(base+"2/x");if err!=nil||string(v)!="keep"{t.Fatal(v,err)};if _,err=a.Read(base+"/x");err==nil{t.Fatal("descendant survived")}

}
func TestFolioInteraction014(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();base:="x.y";err:=a.Apply([]Entry{{Path:base+"/x",Kind:"file",Body:[]byte("x")},{Path:base+"2/x",Kind:"file",Body:[]byte("keep")}});if err!=nil{t.Fatal(err)};if err=a.Apply([]Entry{{Path:base,Kind:"remove"}});err!=nil{t.Fatal(err)};v,err:=a.Read(base+"2/x");if err!=nil||string(v)!="keep"{t.Fatal(v,err)};if _,err=a.Read(base+"/x");err==nil{t.Fatal("descendant survived")}

}
func TestFolioInteraction015(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();base:="a-b";err:=a.Apply([]Entry{{Path:base+"/x",Kind:"file",Body:[]byte("x")},{Path:base+"2/x",Kind:"file",Body:[]byte("keep")}});if err!=nil{t.Fatal(err)};if err=a.Apply([]Entry{{Path:base,Kind:"remove"}});err!=nil{t.Fatal(err)};v,err:=a.Read(base+"2/x");if err!=nil||string(v)!="keep"{t.Fatal(v,err)};if _,err=a.Read(base+"/x");err==nil{t.Fatal("descendant survived")}

}
func TestFolioInteraction016(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();base:="\u00e9";err:=a.Apply([]Entry{{Path:base+"/x",Kind:"file",Body:[]byte("x")},{Path:base+"2/x",Kind:"file",Body:[]byte("keep")}});if err!=nil{t.Fatal(err)};if err=a.Apply([]Entry{{Path:base,Kind:"remove"}});err!=nil{t.Fatal(err)};v,err:=a.Read(base+"2/x");if err!=nil||string(v)!="keep"{t.Fatal(v,err)};if _,err=a.Read(base+"/x");err==nil{t.Fatal("descendant survived")}

}
func TestFolioInteraction017(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();base:="0";err:=a.Apply([]Entry{{Path:base+"/x",Kind:"file",Body:[]byte("x")},{Path:base+"2/x",Kind:"file",Body:[]byte("keep")}});if err!=nil{t.Fatal(err)};if err=a.Apply([]Entry{{Path:base,Kind:"remove"}});err!=nil{t.Fatal(err)};v,err:=a.Read(base+"2/x");if err!=nil||string(v)!="keep"{t.Fatal(v,err)};if _,err=a.Read(base+"/x");err==nil{t.Fatal("descendant survived")}

}
func TestFolioInteraction018(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();base:="a/b";err:=a.Apply([]Entry{{Path:base+"/x",Kind:"file",Body:[]byte("x")},{Path:base+"2/x",Kind:"file",Body:[]byte("keep")}});if err!=nil{t.Fatal(err)};if err=a.Apply([]Entry{{Path:base,Kind:"remove"}});err!=nil{t.Fatal(err)};v,err:=a.Read(base+"2/x");if err!=nil||string(v)!="keep"{t.Fatal(v,err)};if _,err=a.Read(base+"/x");err==nil{t.Fatal("descendant survived")}

}
func TestFolioInteraction019(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();base:="unit";err:=a.Apply([]Entry{{Path:base+"/x",Kind:"file",Body:[]byte("x")},{Path:base+"2/x",Kind:"file",Body:[]byte("keep")}});if err!=nil{t.Fatal(err)};if err=a.Apply([]Entry{{Path:base,Kind:"remove"}});err!=nil{t.Fatal(err)};v,err:=a.Read(base+"2/x");if err!=nil||string(v)!="keep"{t.Fatal(v,err)};if _,err=a.Read(base+"/x");err==nil{t.Fatal("descendant survived")}

}
func TestFolioInteraction020(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();base:="folder";err:=a.Apply([]Entry{{Path:base+"/x",Kind:"file",Body:[]byte("x")},{Path:base+"2/x",Kind:"file",Body:[]byte("keep")}});if err!=nil{t.Fatal(err)};if err=a.Apply([]Entry{{Path:base,Kind:"remove"}});err!=nil{t.Fatal(err)};v,err:=a.Read(base+"2/x");if err!=nil||string(v)!="keep"{t.Fatal(v,err)};if _,err=a.Read(base+"/x");err==nil{t.Fatal("descendant survived")}

}
func TestFolioInteraction021(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();base:="a:a";err:=a.Apply([]Entry{{Path:base+"/x",Kind:"file",Body:[]byte("x")},{Path:base+"2/x",Kind:"file",Body:[]byte("keep")}});if err!=nil{t.Fatal(err)};if err=a.Apply([]Entry{{Path:base,Kind:"remove"}});err!=nil{t.Fatal(err)};v,err:=a.Read(base+"2/x");if err!=nil||string(v)!="keep"{t.Fatal(v,err)};if _,err=a.Read(base+"/x");err==nil{t.Fatal("descendant survived")}

}
func TestFolioInteraction022(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();base:="A";err:=a.Apply([]Entry{{Path:base+"/x",Kind:"file",Body:[]byte("x")},{Path:base+"2/x",Kind:"file",Body:[]byte("keep")}});if err!=nil{t.Fatal(err)};if err=a.Apply([]Entry{{Path:base,Kind:"remove"}});err!=nil{t.Fatal(err)};v,err:=a.Read(base+"2/x");if err!=nil||string(v)!="keep"{t.Fatal(v,err)};if _,err=a.Read(base+"/x");err==nil{t.Fatal("descendant survived")}

}
func TestFolioInteraction023(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();base:="abc";err:=a.Apply([]Entry{{Path:base+"/x",Kind:"file",Body:[]byte("x")},{Path:base+"2/x",Kind:"file",Body:[]byte("keep")}});if err!=nil{t.Fatal(err)};if err=a.Apply([]Entry{{Path:base,Kind:"remove"}});err!=nil{t.Fatal(err)};v,err:=a.Read(base+"2/x");if err!=nil||string(v)!="keep"{t.Fatal(v,err)};if _,err=a.Read(base+"/x");err==nil{t.Fatal("descendant survived")}

}
func TestFolioInteraction024(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"a",Kind:"file",Body:[]byte("a0")},{Path:"Z",Kind:"file",Body:[]byte("Z")},{Path:"B",Kind:"file",Body:[]byte("B")},{Path:"é",Kind:"file",Body:[]byte("u")}});if err!=nil{t.Fatal(err)};entries:=a.Entries();var names []string;for _,e:=range entries{names=append(names,e.Path)};if !reflect.DeepEqual(names,[]string{"B","Z","a","é"}){t.Fatal(names)};data,err:=a.Tar();if err!=nil{t.Fatal(err)};r:=tar.NewReader(bytes.NewReader(data));var got []string;for{h,err:=r.Next();if err==io.EOF{break};if err!=nil{t.Fatal(err)};got=append(got,h.Name)};if !reflect.DeepEqual(got,names){t.Fatal(got,names)}

}
func TestFolioInteraction025(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"a",Kind:"file",Body:[]byte("a1")},{Path:"Z",Kind:"file",Body:[]byte("Z")},{Path:"B",Kind:"file",Body:[]byte("B")},{Path:"é",Kind:"file",Body:[]byte("u")}});if err!=nil{t.Fatal(err)};entries:=a.Entries();var names []string;for _,e:=range entries{names=append(names,e.Path)};if !reflect.DeepEqual(names,[]string{"B","Z","a","é"}){t.Fatal(names)};data,err:=a.Tar();if err!=nil{t.Fatal(err)};r:=tar.NewReader(bytes.NewReader(data));var got []string;for{h,err:=r.Next();if err==io.EOF{break};if err!=nil{t.Fatal(err)};got=append(got,h.Name)};if !reflect.DeepEqual(got,names){t.Fatal(got,names)}

}
func TestFolioInteraction026(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"a",Kind:"file",Body:[]byte("a2")},{Path:"Z",Kind:"file",Body:[]byte("Z")},{Path:"B",Kind:"file",Body:[]byte("B")},{Path:"é",Kind:"file",Body:[]byte("u")}});if err!=nil{t.Fatal(err)};entries:=a.Entries();var names []string;for _,e:=range entries{names=append(names,e.Path)};if !reflect.DeepEqual(names,[]string{"B","Z","a","é"}){t.Fatal(names)};data,err:=a.Tar();if err!=nil{t.Fatal(err)};r:=tar.NewReader(bytes.NewReader(data));var got []string;for{h,err:=r.Next();if err==io.EOF{break};if err!=nil{t.Fatal(err)};got=append(got,h.Name)};if !reflect.DeepEqual(got,names){t.Fatal(got,names)}

}
func TestFolioInteraction027(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"a",Kind:"file",Body:[]byte("a3")},{Path:"Z",Kind:"file",Body:[]byte("Z")},{Path:"B",Kind:"file",Body:[]byte("B")},{Path:"é",Kind:"file",Body:[]byte("u")}});if err!=nil{t.Fatal(err)};entries:=a.Entries();var names []string;for _,e:=range entries{names=append(names,e.Path)};if !reflect.DeepEqual(names,[]string{"B","Z","a","é"}){t.Fatal(names)};data,err:=a.Tar();if err!=nil{t.Fatal(err)};r:=tar.NewReader(bytes.NewReader(data));var got []string;for{h,err:=r.Next();if err==io.EOF{break};if err!=nil{t.Fatal(err)};got=append(got,h.Name)};if !reflect.DeepEqual(got,names){t.Fatal(got,names)}

}
func TestFolioInteraction028(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"a",Kind:"file",Body:[]byte("a4")},{Path:"Z",Kind:"file",Body:[]byte("Z")},{Path:"B",Kind:"file",Body:[]byte("B")},{Path:"é",Kind:"file",Body:[]byte("u")}});if err!=nil{t.Fatal(err)};entries:=a.Entries();var names []string;for _,e:=range entries{names=append(names,e.Path)};if !reflect.DeepEqual(names,[]string{"B","Z","a","é"}){t.Fatal(names)};data,err:=a.Tar();if err!=nil{t.Fatal(err)};r:=tar.NewReader(bytes.NewReader(data));var got []string;for{h,err:=r.Next();if err==io.EOF{break};if err!=nil{t.Fatal(err)};got=append(got,h.Name)};if !reflect.DeepEqual(got,names){t.Fatal(got,names)}

}
func TestFolioInteraction029(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"a",Kind:"file",Body:[]byte("a5")},{Path:"Z",Kind:"file",Body:[]byte("Z")},{Path:"B",Kind:"file",Body:[]byte("B")},{Path:"é",Kind:"file",Body:[]byte("u")}});if err!=nil{t.Fatal(err)};entries:=a.Entries();var names []string;for _,e:=range entries{names=append(names,e.Path)};if !reflect.DeepEqual(names,[]string{"B","Z","a","é"}){t.Fatal(names)};data,err:=a.Tar();if err!=nil{t.Fatal(err)};r:=tar.NewReader(bytes.NewReader(data));var got []string;for{h,err:=r.Next();if err==io.EOF{break};if err!=nil{t.Fatal(err)};got=append(got,h.Name)};if !reflect.DeepEqual(got,names){t.Fatal(got,names)}

}
func TestFolioInteraction030(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"a",Kind:"file",Body:[]byte("a6")},{Path:"Z",Kind:"file",Body:[]byte("Z")},{Path:"B",Kind:"file",Body:[]byte("B")},{Path:"é",Kind:"file",Body:[]byte("u")}});if err!=nil{t.Fatal(err)};entries:=a.Entries();var names []string;for _,e:=range entries{names=append(names,e.Path)};if !reflect.DeepEqual(names,[]string{"B","Z","a","é"}){t.Fatal(names)};data,err:=a.Tar();if err!=nil{t.Fatal(err)};r:=tar.NewReader(bytes.NewReader(data));var got []string;for{h,err:=r.Next();if err==io.EOF{break};if err!=nil{t.Fatal(err)};got=append(got,h.Name)};if !reflect.DeepEqual(got,names){t.Fatal(got,names)}

}
func TestFolioInteraction031(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"a",Kind:"file",Body:[]byte("a7")},{Path:"Z",Kind:"file",Body:[]byte("Z")},{Path:"B",Kind:"file",Body:[]byte("B")},{Path:"é",Kind:"file",Body:[]byte("u")}});if err!=nil{t.Fatal(err)};entries:=a.Entries();var names []string;for _,e:=range entries{names=append(names,e.Path)};if !reflect.DeepEqual(names,[]string{"B","Z","a","é"}){t.Fatal(names)};data,err:=a.Tar();if err!=nil{t.Fatal(err)};r:=tar.NewReader(bytes.NewReader(data));var got []string;for{h,err:=r.Next();if err==io.EOF{break};if err!=nil{t.Fatal(err)};got=append(got,h.Name)};if !reflect.DeepEqual(got,names){t.Fatal(got,names)}

}
func TestFolioInteraction032(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"a",Kind:"file",Body:[]byte("a8")},{Path:"Z",Kind:"file",Body:[]byte("Z")},{Path:"B",Kind:"file",Body:[]byte("B")},{Path:"é",Kind:"file",Body:[]byte("u")}});if err!=nil{t.Fatal(err)};entries:=a.Entries();var names []string;for _,e:=range entries{names=append(names,e.Path)};if !reflect.DeepEqual(names,[]string{"B","Z","a","é"}){t.Fatal(names)};data,err:=a.Tar();if err!=nil{t.Fatal(err)};r:=tar.NewReader(bytes.NewReader(data));var got []string;for{h,err:=r.Next();if err==io.EOF{break};if err!=nil{t.Fatal(err)};got=append(got,h.Name)};if !reflect.DeepEqual(got,names){t.Fatal(got,names)}

}
func TestFolioInteraction033(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"a",Kind:"file",Body:[]byte("a9")},{Path:"Z",Kind:"file",Body:[]byte("Z")},{Path:"B",Kind:"file",Body:[]byte("B")},{Path:"é",Kind:"file",Body:[]byte("u")}});if err!=nil{t.Fatal(err)};entries:=a.Entries();var names []string;for _,e:=range entries{names=append(names,e.Path)};if !reflect.DeepEqual(names,[]string{"B","Z","a","é"}){t.Fatal(names)};data,err:=a.Tar();if err!=nil{t.Fatal(err)};r:=tar.NewReader(bytes.NewReader(data));var got []string;for{h,err:=r.Next();if err==io.EOF{break};if err!=nil{t.Fatal(err)};got=append(got,h.Name)};if !reflect.DeepEqual(got,names){t.Fatal(got,names)}

}
func TestFolioInteraction034(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"a",Kind:"file",Body:[]byte("a10")},{Path:"Z",Kind:"file",Body:[]byte("Z")},{Path:"B",Kind:"file",Body:[]byte("B")},{Path:"é",Kind:"file",Body:[]byte("u")}});if err!=nil{t.Fatal(err)};entries:=a.Entries();var names []string;for _,e:=range entries{names=append(names,e.Path)};if !reflect.DeepEqual(names,[]string{"B","Z","a","é"}){t.Fatal(names)};data,err:=a.Tar();if err!=nil{t.Fatal(err)};r:=tar.NewReader(bytes.NewReader(data));var got []string;for{h,err:=r.Next();if err==io.EOF{break};if err!=nil{t.Fatal(err)};got=append(got,h.Name)};if !reflect.DeepEqual(got,names){t.Fatal(got,names)}

}
func TestFolioInteraction035(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"a",Kind:"file",Body:[]byte("a11")},{Path:"Z",Kind:"file",Body:[]byte("Z")},{Path:"B",Kind:"file",Body:[]byte("B")},{Path:"é",Kind:"file",Body:[]byte("u")}});if err!=nil{t.Fatal(err)};entries:=a.Entries();var names []string;for _,e:=range entries{names=append(names,e.Path)};if !reflect.DeepEqual(names,[]string{"B","Z","a","é"}){t.Fatal(names)};data,err:=a.Tar();if err!=nil{t.Fatal(err)};r:=tar.NewReader(bytes.NewReader(data));var got []string;for{h,err:=r.Next();if err==io.EOF{break};if err!=nil{t.Fatal(err)};got=append(got,h.Name)};if !reflect.DeepEqual(got,names){t.Fatal(got,names)}

}
func TestFolioInteraction036(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"title",Kind:"file",Body:[]byte("root")},{Path:"docs/link",Kind:"symlink",Target:"../title"}});if err!=nil{t.Fatal(err)};v,err:=a.Read("docs/link");if err!=nil||string(v)!="root"{t.Fatal(v,err)}

}
func TestFolioInteraction037(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"title",Kind:"file",Body:[]byte("root")},{Path:"docs/link",Kind:"symlink",Target:"./../title"}});if err!=nil{t.Fatal(err)};v,err:=a.Read("docs/link");if err!=nil||string(v)!="root"{t.Fatal(v,err)}

}
func TestFolioInteraction038(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();err:=a.Apply([]Entry{{Path:"title",Kind:"file",Body:[]byte("root")},{Path:"docs/link",Kind:"symlink",Target:".././title"}});if err!=nil{t.Fatal(err)};v,err:=a.Read("docs/link");if err!=nil||string(v)!="root"{t.Fatal(v,err)}

}
func TestFolioInteraction039(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();if err:=a.Apply([]Entry{{Path:"a",Kind:"symlink",Target:"b"},{Path:"b",Kind:"symlink",Target:"a"}});err!=nil{t.Fatal(err)};if _,err:=a.Read("a");err==nil{t.Fatal("cycle") }
}
func TestFolioInteraction040(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();if err:=a.Apply([]Entry{{Path:"dir/x",Kind:"file",Body:[]byte("x")},{Path:"dir/l",Kind:"symlink",Target:"x"},{Path:"copy",Kind:"hardlink",Target:"dir/l"}});err!=nil{t.Fatal(err)};if err:=a.Apply([]Entry{{Path:"dir",Kind:"remove"}});err!=nil{t.Fatal(err)};v,err:=a.Read("copy");if err!=nil||string(v)!="x"{t.Fatal(v,err)}
}
func TestFolioInteraction041(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();if err:=a.Apply([]Entry{{Path:"a",Kind:"file",Body:[]byte("a")},{Path:"copy",Kind:"hardlink",Target:"a"}});err!=nil{t.Fatal(err)};e,_:=a.Stat("copy");e.Body[0]='X';v,_:=a.Read("copy");if string(v)!="a"{t.Fatal("alias") }
}
func TestFolioBoundary000(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();if err:=a.Apply([]Entry{{Path:"d/x",Kind:"file",Body:[]byte("x")},{Path:"d/l",Kind:"symlink",Target:"/x"}});err!=nil{t.Fatal(err)};if _,err:=a.Read("d/l");err==nil{t.Fatal("absolute target")}
}
func TestFolioBoundary001(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();if err:=a.Apply([]Entry{{Path:"d/l",Kind:"symlink",Target:"../../x"}});err!=nil{t.Fatal(err)};if _,err:=a.Read("d/l");err==nil{t.Fatal("escape")}
}
func TestFolioBoundary002(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();if err:=a.Apply([]Entry{{Path:"d/x",Kind:"file",Body:[]byte("x")},{Path:"other",Kind:"symlink",Target:"d"}});err!=nil{t.Fatal(err)};v,err:=a.Read("other/x");if err!=nil||string(v)!="x"{t.Fatal(v,err)}
}
func TestFolioBoundary003(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();if err:=a.Apply([]Entry{{Path:"d",Kind:"dir",Mode:0755}});err!=nil{t.Fatal(err)};before:=a.Digest();if err:=a.Apply([]Entry{{Path:"copy",Kind:"hardlink",Target:"d"}});err==nil{t.Fatal("hardlink dir")};if a.Digest()!=before{t.Fatal("atomicity")}
}
func TestFolioBoundary004(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();input:=[]byte("x");if err:=a.Apply([]Entry{{Path:"original",Kind:"file",Body:input},{Path:"copy",Kind:"hardlink",Target:"original"}});err!=nil{t.Fatal(err)};input[0]='y';if err:=a.Apply([]Entry{{Path:"copy",Kind:"file",Body:[]byte("new")}});err!=nil{t.Fatal(err)};v,err:=a.Read("original");if err!=nil||string(v)!="x"{t.Fatal(v,err)}
}
func TestFolioBoundary005(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();if err:=a.Apply([]Entry{{Path:"x",Kind:"file",Body:[]byte("x")},{Path:"b",Kind:"hardlink",Target:"x"},{Path:"c",Kind:"hardlink",Target:"b"},{Path:"x",Kind:"remove"},{Path:"b",Kind:"remove"}});err!=nil{t.Fatal(err)};v,err:=a.Read("c");if err!=nil||string(v)!="x"{t.Fatal(v,err)}
}
func TestFolioLinkTraversal0(t *testing.T){
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();if err:=a.Apply([]Entry{{Path:"a",Kind:"symlink",Target:"a/b"}});err!=nil{t.Fatal(err)};if _,err:=a.Read("a");err==nil{t.Fatal("expanding cycle")}
}
func TestFolioLinkTraversal1(t *testing.T){
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();if err:=a.Apply([]Entry{{Path:"a",Kind:"symlink",Target:"b/c"},{Path:"b",Kind:"symlink",Target:"a/d"}});err!=nil{t.Fatal(err)};if _,err:=a.Read("a");err==nil{t.Fatal("growing cycle")}
}
func TestFolioLinkTraversal2(t *testing.T){
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();if err:=a.Apply([]Entry{{Path:"alias",Kind:"symlink",Target:"."},{Path:"x",Kind:"file",Body:[]byte("x")}});err!=nil{t.Fatal(err)};v,err:=a.Read("alias/alias/x");if err!=nil||string(v)!="x"{t.Fatal(v,err)}
}
func TestFolioLinkTraversal3(t *testing.T){
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
a:=NewArchive();if err:=a.Apply([]Entry{{Path:"docs/x",Kind:"file",Body:[]byte("x")},{Path:"docs/alias",Kind:"symlink",Target:"../docs"}});err!=nil{t.Fatal(err)};v,err:=a.Read("docs/alias/alias/x");if err!=nil||string(v)!="x"{t.Fatal(v,err)}
}
