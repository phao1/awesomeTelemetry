package checks
import (
"testing"
. "workspace"
"reflect"
)
func TestWaypointInteraction000(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(0)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(0),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction001(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(1)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(1),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction002(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(2)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(2),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction003(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(3)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(3),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction004(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(4)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(4),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction005(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(5)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(5),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction006(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(6)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(6),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction007(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(7)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(7),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction008(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(8)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(8),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction009(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(9)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(9),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction010(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(10)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(10),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction011(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(11)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(11),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction012(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(12)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(12),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction013(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(13)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(13),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction014(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)},"n":nil}
ops:=[]Operation{{Op:"add",Path:"/a/1",Value:float64(14)},{Op:"move",From:"/a/0",Path:"/a/-"},{Op:"copy",From:"/a",Path:"/b"},{Op:"replace",Path:"/a/0",Value:nil}}
out,err:=Apply(input,ops)
want:=map[string]any{"a":[]any{nil,float64(2),float64(3),float64(1)},"b":[]any{float64(14),float64(2),float64(3),float64(1)},"n":nil}
if err!=nil || !reflect.DeepEqual(out,want) {t.Fatal(out,err,want)}
if !reflect.DeepEqual(input["a"],[]any{float64(1),float64(2),float64(3)}) {t.Fatal("input mutated")}

}
func TestWaypointInteraction015(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
original:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"add",Path:"/new",Value:true},{Op:"replace",Path:"/a/00",Value:nil}})
if err==nil || out!=nil {t.Fatal(out,err)}
if !reflect.DeepEqual(input,original) {t.Fatal("atomicity")}

}
func TestWaypointInteraction016(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
original:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"add",Path:"/new",Value:true},{Op:"replace",Path:"/a/-1",Value:nil}})
if err==nil || out!=nil {t.Fatal(out,err)}
if !reflect.DeepEqual(input,original) {t.Fatal("atomicity")}

}
func TestWaypointInteraction017(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
original:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"add",Path:"/new",Value:true},{Op:"replace",Path:"/a/+1",Value:nil}})
if err==nil || out!=nil {t.Fatal(out,err)}
if !reflect.DeepEqual(input,original) {t.Fatal("atomicity")}

}
func TestWaypointInteraction018(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
original:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"add",Path:"/new",Value:true},{Op:"replace",Path:"/a/3",Value:nil}})
if err==nil || out!=nil {t.Fatal(out,err)}
if !reflect.DeepEqual(input,original) {t.Fatal("atomicity")}

}
func TestWaypointInteraction019(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
original:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"add",Path:"/new",Value:true},{Op:"replace",Path:"/a/-",Value:nil}})
if err==nil || out!=nil {t.Fatal(out,err)}
if !reflect.DeepEqual(input,original) {t.Fatal("atomicity")}

}
func TestWaypointInteraction020(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
original:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"add",Path:"/new",Value:true},{Op:"replace",Path:"/a/9999999999999999999999999",Value:nil}})
if err==nil || out!=nil {t.Fatal(out,err)}
if !reflect.DeepEqual(input,original) {t.Fatal("atomicity")}

}
func TestWaypointInteraction021(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
original:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"add",Path:"/new",Value:true},{Op:"replace",Path:"/x/y",Value:nil}})
if err==nil || out!=nil {t.Fatal(out,err)}
if !reflect.DeepEqual(input,original) {t.Fatal("atomicity")}

}
func TestWaypointInteraction022(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
original:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"add",Path:"/new",Value:true},{Op:"replace",Path:"bad",Value:nil}})
if err==nil || out!=nil {t.Fatal(out,err)}
if !reflect.DeepEqual(input,original) {t.Fatal("atomicity")}

}
func TestWaypointInteraction023(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
original:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"add",Path:"/new",Value:true},{Op:"replace",Path:"/~2",Value:nil}})
if err==nil || out!=nil {t.Fatal(out,err)}
if !reflect.DeepEqual(input,original) {t.Fatal("atomicity")}

}
func TestWaypointInteraction024(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
original:=map[string]any{"a":[]any{float64(1),float64(2),float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"add",Path:"/new",Value:true},{Op:"replace",Path:"/~",Value:nil}})
if err==nil || out!=nil {t.Fatal(out,err)}
if !reflect.DeepEqual(input,original) {t.Fatal("atomicity")}

}
func TestWaypointInteraction025(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a/b":nil}
out,err:=Apply(input,[]Operation{{Op:"test",Path:"/a~1b",Value:nil},{Op:"replace",Path:"/a~1b",Value:float64(8)}})
if err!=nil || out.(map[string]any)["a/b"]!=float64(8) {t.Fatal(out,err)}
if input["a/b"]!=nil {t.Fatal("alias")}

}
func TestWaypointInteraction026(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"~1":nil}
out,err:=Apply(input,[]Operation{{Op:"test",Path:"/~01",Value:nil},{Op:"replace",Path:"/~01",Value:float64(8)}})
if err!=nil || out.(map[string]any)["~1"]!=float64(8) {t.Fatal(out,err)}
if input["~1"]!=nil {t.Fatal("alias")}

}
func TestWaypointInteraction027(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"":nil}
out,err:=Apply(input,[]Operation{{Op:"test",Path:"/",Value:nil},{Op:"replace",Path:"/",Value:float64(8)}})
if err!=nil || out.(map[string]any)[""]!=float64(8) {t.Fatal(out,err)}
if input[""]!=nil {t.Fatal("alias")}

}
func TestWaypointInteraction028(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"\u00e9":nil}
out,err:=Apply(input,[]Operation{{Op:"test",Path:"/\u00e9",Value:nil},{Op:"replace",Path:"/\u00e9",Value:float64(8)}})
if err!=nil || out.(map[string]any)["\u00e9"]!=float64(8) {t.Fatal(out,err)}
if input["\u00e9"]!=nil {t.Fatal("alias")}

}
func TestWaypointInteraction029(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"-":nil}
out,err:=Apply(input,[]Operation{{Op:"test",Path:"/-",Value:nil},{Op:"replace",Path:"/-",Value:float64(8)}})
if err!=nil || out.(map[string]any)["-"]!=float64(8) {t.Fatal(out,err)}
if input["-"]!=nil {t.Fatal("alias")}

}
func TestWaypointInteraction030(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a~b":nil}
out,err:=Apply(input,[]Operation{{Op:"test",Path:"/a~0b",Value:nil},{Op:"replace",Path:"/a~0b",Value:float64(8)}})
if err!=nil || out.(map[string]any)["a~b"]!=float64(8) {t.Fatal(out,err)}
if input["a~b"]!=nil {t.Fatal("alias")}

}
func TestWaypointInteraction031(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":map[string]any{"x":float64(1)}};out,err:=Apply(input,[]Operation{{Op:"copy",From:"/a",Path:"/a/b"}});if err!=nil{t.Fatal(err)};want:=map[string]any{"a":map[string]any{"x":float64(1),"b":map[string]any{"x":float64(1)}}};if !reflect.DeepEqual(out,want){t.Fatal(out)}
}
func TestWaypointInteraction032(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":map[string]any{"x":float64(1)}};out,err:=Apply(input,[]Operation{{Op:"move",From:"/a",Path:"/a/b"}});if err==nil||out!=nil{t.Fatal(out,err)};if len(input["a"].(map[string]any))!=1{t.Fatal(input)}
}
func TestWaypointInteraction033(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"ab":float64(1),"a":map[string]any{}};out,err:=Apply(input,[]Operation{{Op:"move",From:"/ab",Path:"/a/b"}});if err!=nil||out.(map[string]any)["a"].(map[string]any)["b"]!=float64(1){t.Fatal(out,err)}
}
func TestWaypointInteraction034(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
for _,op:=range []string{"test","replace","remove","copy","move"}{from:="/missing";out,err:=Apply(map[string]any{},[]Operation{{Op:op,Path:"/missing",From:from}});if err==nil||out!=nil{t.Fatal(op,out,err)}}
}
func TestWaypointInteraction035(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=[]any{float64(1),float64(2),float64(3)};out,err:=Apply(input,[]Operation{{Op:"move",From:"/0",Path:"/2"}});if err!=nil||!reflect.DeepEqual(out,[]any{float64(2),float64(3),float64(1)}){t.Fatal(out,err)}
}
func TestWaypointInteraction036(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
out,err:=Apply(nil,[]Operation{{Op:"add",Path:"",Value:map[string]any{"a":nil}},{Op:"test",Path:"/a",Value:nil},{Op:"remove",Path:""}});if err!=nil||out!=nil{t.Fatal(out,err)}
}
func TestWaypointInteraction037(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
out,err:=Apply(map[string]any{"a":nil},[]Operation{{Op:"move",From:"/a",Path:"/a"}});if err!=nil||!reflect.DeepEqual(out,map[string]any{"a":nil}){t.Fatal(out,err)}
}
func TestWaypointInteraction038(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
out,err:=Apply(map[string]any{"a":float64(1)},[]Operation{{Op:"test",Path:"/a",Value:"1"}});if err==nil||out!=nil{t.Fatal(out,err)}
}
func TestWaypointInteraction039(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":[]any{float64(1)}};out,err:=Apply(input,nil);if err!=nil{t.Fatal(err)};out.(map[string]any)["a"].([]any)[0]=float64(9);if input["a"].([]any)[0]!=float64(1){t.Fatal("alias")}
}
func TestWaypointInteraction040(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
out,err:=Apply(nil,[]Operation{{Op:"unknown",Path:""}});if err==nil||out!=nil{t.Fatal(out,err)}
}
func TestWaypointInteraction041(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":map[string]any{"gone":true,"keep":float64(1)},"scalar":float64(2),"list":[]any{float64(1)}}
patch:=map[string]any{"a":map[string]any{"gone":nil,"new":float64(0)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"merge",Path:"",Value:patch}})
want:=map[string]any{"a":map[string]any{"keep":float64(1),"new":float64(0)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
if err!=nil||!reflect.DeepEqual(out,want){t.Fatal(out,err)}
if input["a"].(map[string]any)["gone"]!=true||patch["a"].(map[string]any)["gone"]!=nil{t.Fatal("mutation")}

}
func TestWaypointInteraction042(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":map[string]any{"gone":true,"keep":float64(1)},"scalar":float64(2),"list":[]any{float64(1)}}
patch:=map[string]any{"a":map[string]any{"gone":nil,"new":float64(1)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"merge",Path:"",Value:patch}})
want:=map[string]any{"a":map[string]any{"keep":float64(1),"new":float64(1)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
if err!=nil||!reflect.DeepEqual(out,want){t.Fatal(out,err)}
if input["a"].(map[string]any)["gone"]!=true||patch["a"].(map[string]any)["gone"]!=nil{t.Fatal("mutation")}

}
func TestWaypointInteraction043(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":map[string]any{"gone":true,"keep":float64(1)},"scalar":float64(2),"list":[]any{float64(1)}}
patch:=map[string]any{"a":map[string]any{"gone":nil,"new":float64(2)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"merge",Path:"",Value:patch}})
want:=map[string]any{"a":map[string]any{"keep":float64(1),"new":float64(2)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
if err!=nil||!reflect.DeepEqual(out,want){t.Fatal(out,err)}
if input["a"].(map[string]any)["gone"]!=true||patch["a"].(map[string]any)["gone"]!=nil{t.Fatal("mutation")}

}
func TestWaypointInteraction044(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":map[string]any{"gone":true,"keep":float64(1)},"scalar":float64(2),"list":[]any{float64(1)}}
patch:=map[string]any{"a":map[string]any{"gone":nil,"new":float64(3)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"merge",Path:"",Value:patch}})
want:=map[string]any{"a":map[string]any{"keep":float64(1),"new":float64(3)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
if err!=nil||!reflect.DeepEqual(out,want){t.Fatal(out,err)}
if input["a"].(map[string]any)["gone"]!=true||patch["a"].(map[string]any)["gone"]!=nil{t.Fatal("mutation")}

}
func TestWaypointInteraction045(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":map[string]any{"gone":true,"keep":float64(1)},"scalar":float64(2),"list":[]any{float64(1)}}
patch:=map[string]any{"a":map[string]any{"gone":nil,"new":float64(4)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"merge",Path:"",Value:patch}})
want:=map[string]any{"a":map[string]any{"keep":float64(1),"new":float64(4)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
if err!=nil||!reflect.DeepEqual(out,want){t.Fatal(out,err)}
if input["a"].(map[string]any)["gone"]!=true||patch["a"].(map[string]any)["gone"]!=nil{t.Fatal("mutation")}

}
func TestWaypointInteraction046(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":map[string]any{"gone":true,"keep":float64(1)},"scalar":float64(2),"list":[]any{float64(1)}}
patch:=map[string]any{"a":map[string]any{"gone":nil,"new":float64(5)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"merge",Path:"",Value:patch}})
want:=map[string]any{"a":map[string]any{"keep":float64(1),"new":float64(5)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
if err!=nil||!reflect.DeepEqual(out,want){t.Fatal(out,err)}
if input["a"].(map[string]any)["gone"]!=true||patch["a"].(map[string]any)["gone"]!=nil{t.Fatal("mutation")}

}
func TestWaypointInteraction047(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":map[string]any{"gone":true,"keep":float64(1)},"scalar":float64(2),"list":[]any{float64(1)}}
patch:=map[string]any{"a":map[string]any{"gone":nil,"new":float64(6)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"merge",Path:"",Value:patch}})
want:=map[string]any{"a":map[string]any{"keep":float64(1),"new":float64(6)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
if err!=nil||!reflect.DeepEqual(out,want){t.Fatal(out,err)}
if input["a"].(map[string]any)["gone"]!=true||patch["a"].(map[string]any)["gone"]!=nil{t.Fatal("mutation")}

}
func TestWaypointInteraction048(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":map[string]any{"gone":true,"keep":float64(1)},"scalar":float64(2),"list":[]any{float64(1)}}
patch:=map[string]any{"a":map[string]any{"gone":nil,"new":float64(7)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
out,err:=Apply(input,[]Operation{{Op:"merge",Path:"",Value:patch}})
want:=map[string]any{"a":map[string]any{"keep":float64(1),"new":float64(7)},"scalar":map[string]any{"x":true},"list":[]any{float64(3)}}
if err!=nil||!reflect.DeepEqual(out,want){t.Fatal(out,err)}
if input["a"].(map[string]any)["gone"]!=true||patch["a"].(map[string]any)["gone"]!=nil{t.Fatal("mutation")}

}
func TestWaypointInteraction049(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
for _,value:=range []any{nil,float64(1),[]any{}}{out,err:=Apply(value,[]Operation{{Op:"merge",Path:"",Value:map[string]any{}}});if err==nil||out!=nil{t.Fatal(out,err)}}
}
func TestWaypointInteraction050(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
out,err:=Apply(map[string]any{},[]Operation{{Op:"merge",Path:"",Value:float64(1)}});if err==nil||out!=nil{t.Fatal(out,err)}
}
func TestWaypointBoundary000(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
out,err:=Apply([]any{float64(1)},[]Operation{{Op:"add",Path:"/1",Value:float64(2)}});if err!=nil||!reflect.DeepEqual(out,[]any{float64(1),float64(2)}){t.Fatal(out,err)}
}
func TestWaypointBoundary001(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
for _,path:=range []string{"/2","/01","/+1","/-1","/9999999999999999999999999999"}{out,err:=Apply([]any{float64(1)},[]Operation{{Op:"add",Path:path,Value:true}});if err==nil||out!=nil{t.Fatal(path,out,err)}}
}
func TestWaypointBoundary002(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
out,err:=Apply(map[string]any{"a":[]any{[]any{float64(1),float64(2)}}},[]Operation{{Op:"add",Path:"/a/0/0",Value:float64(0)},{Op:"remove",Path:"/a/0/2"}});want:=map[string]any{"a":[]any{[]any{float64(0),float64(1)}}};if err!=nil||!reflect.DeepEqual(out,want){t.Fatal(out,err)}
}
func TestWaypointBoundary003(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":map[string]any{"keep":true},"b":float64(1)};out,err:=Apply(input,[]Operation{{Op:"merge",Path:"",Value:map[string]any{"a":map[string]any{},"b":map[string]any{},"missing":nil}}});want:=map[string]any{"a":map[string]any{"keep":true},"b":map[string]any{}};if err!=nil||!reflect.DeepEqual(out,want){t.Fatal(out,err)}
}
func TestWaypointBoundary004(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":map[string]any{"x":float64(1)}};out,err:=Apply(input,[]Operation{{Op:"merge",Path:"/a",Value:map[string]any{"x":nil,"y":false}}});want:=map[string]any{"a":map[string]any{"y":false}};if err!=nil||!reflect.DeepEqual(out,want){t.Fatal(out,err)};if input["a"].(map[string]any)["x"]!=float64(1){t.Fatal("input")}
}
func TestWaypointBoundary005(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":true};out,err:=Apply(input,[]Operation{{Op:"merge",Path:"/missing",Value:map[string]any{}}});if err==nil||out!=nil{t.Fatal(out,err)}
}
func TestWaypointBoundary006(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":map[string]any{"x":true}};out,err:=Apply(input,[]Operation{{Op:"merge",Path:"/a",Value:map[string]any{"x":nil}},{Op:"test",Path:"/a",Value:true}});if err==nil||out!=nil{t.Fatal(out,err)};if input["a"].(map[string]any)["x"]!=true{t.Fatal("atomicity")}
}
func TestWaypointBoundary007(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=map[string]any{"a":true};out,err:=Apply(input,[]Operation{{Op:"copy",From:"",Path:"/nested"}});want:=map[string]any{"a":true,"nested":map[string]any{"a":true}};if err!=nil||!reflect.DeepEqual(out,want){t.Fatal(out,err)}
}
func TestWaypointBoundary008(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
out,err:=Apply(map[string]any{"a":[]any{false,nil}},[]Operation{{Op:"move",From:"/a",Path:""}});if err!=nil||!reflect.DeepEqual(out,[]any{false,nil}){t.Fatal(out,err)}
}
func TestWaypointBoundary009(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
out,err:=Apply(nil,[]Operation{{Op:"replace",Path:"",Value:map[string]any{}},{Op:"add",Path:"/",Value:true},{Op:"test",Path:"/",Value:true}});if err!=nil||!reflect.DeepEqual(out,map[string]any{"":true}){t.Fatal(out,err)}
}
