package checks
import (
"testing"
. "workspace"
"sort"
"reflect"
"strconv"
"math"
)
func TestStrataInteraction000(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(1);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction001(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(2);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction002(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(3);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction003(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(4);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction004(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(5);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction005(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(6);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction006(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(7);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction007(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(8);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction008(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(9);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction009(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(10);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction010(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(11);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction011(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(12);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction012(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(13);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction013(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(14);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction014(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(15);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction015(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(16);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction016(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(17);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction017(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(18);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction018(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(19);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction019(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(20);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction020(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(21);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction021(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(22);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction022(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(23);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction023(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(24);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction024(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(25);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction025(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(26);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction026(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(27);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction027(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(28);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction028(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(29);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction029(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(30);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction030(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(31);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction031(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(32);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction032(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(33);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction033(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(34);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction034(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(35);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction035(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
state:=uint32(36);next:=func()int{state=state*1664525+1013904223;return int(state%101)}
var input []Span
for i:=0;i<70;i++{a:=next()-50;b:=next()-50;input=append(input,Span{a,b,next()%9-4,strconv.Itoa(next()%4),next()%2==0})}
before:=append([]Span(nil),input...)
got:=Envelope(input,ordering);want:=oracle(input)
if !reflect.DeepEqual(got,want){t.Fatal(got,want)}
if !reflect.DeepEqual(input,before){t.Fatal("mutated")}

}
func TestStrataInteraction036(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
n:=512;input:=make([]Span,n)
for i:=range input{input[i]=Span{i,2*n-i,i%23,"x",i%2==0}}
calls:=0;cmp:=func(a,b int)int{calls++;return ordering(a,b)}
got:=Envelope(input,cmp)
if !reflect.DeepEqual(got,oracle(input)){t.Fatal("envelope")}
budget:=96*n*int(math.Ceil(math.Log2(float64(n+2))))
if calls>budget{t.Fatal("comparison budget",calls,budget)}

}
func TestStrataInteraction037(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
n:=512;input:=make([]Span,n)
for i:=range input{input[i]=Span{-i,i+1,i%23,"x",i%2==0}}
calls:=0;cmp:=func(a,b int)int{calls++;return ordering(a,b)}
got:=Envelope(input,cmp)
if !reflect.DeepEqual(got,oracle(input)){t.Fatal("envelope")}
budget:=96*n*int(math.Ceil(math.Log2(float64(n+2))))
if calls>budget{t.Fatal("comparison budget",calls,budget)}

}
func TestStrataInteraction038(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
n:=512;input:=make([]Span,n)
for i:=range input{input[i]=Span{i%17,n+i,i%23,"x",i%2==0}}
calls:=0;cmp:=func(a,b int)int{calls++;return ordering(a,b)}
got:=Envelope(input,cmp)
if !reflect.DeepEqual(got,oracle(input)){t.Fatal("envelope")}
budget:=96*n*int(math.Ceil(math.Log2(float64(n+2))))
if calls>budget{t.Fatal("comparison budget",calls,budget)}

}
func TestStrataInteraction039(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
n:=1024;input:=make([]Span,n)
for i:=range input{input[i]=Span{i,2*n-i,i%23,"x",i%2==0}}
calls:=0;cmp:=func(a,b int)int{calls++;return ordering(a,b)}
got:=Envelope(input,cmp)
if !reflect.DeepEqual(got,oracle(input)){t.Fatal("envelope")}
budget:=96*n*int(math.Ceil(math.Log2(float64(n+2))))
if calls>budget{t.Fatal("comparison budget",calls,budget)}

}
func TestStrataInteraction040(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
n:=1024;input:=make([]Span,n)
for i:=range input{input[i]=Span{-i,i+1,i%23,"x",i%2==0}}
calls:=0;cmp:=func(a,b int)int{calls++;return ordering(a,b)}
got:=Envelope(input,cmp)
if !reflect.DeepEqual(got,oracle(input)){t.Fatal("envelope")}
budget:=96*n*int(math.Ceil(math.Log2(float64(n+2))))
if calls>budget{t.Fatal("comparison budget",calls,budget)}

}
func TestStrataInteraction041(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
n:=1024;input:=make([]Span,n)
for i:=range input{input[i]=Span{i%17,n+i,i%23,"x",i%2==0}}
calls:=0;cmp:=func(a,b int)int{calls++;return ordering(a,b)}
got:=Envelope(input,cmp)
if !reflect.DeepEqual(got,oracle(input)){t.Fatal("envelope")}
budget:=96*n*int(math.Ceil(math.Log2(float64(n+2))))
if calls>budget{t.Fatal("comparison budget",calls,budget)}

}
func TestStrataInteraction042(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
n:=4096;input:=make([]Span,n)
for i:=range input{input[i]=Span{i,2*n-i,i%23,"x",i%2==0}}
calls:=0;cmp:=func(a,b int)int{calls++;return ordering(a,b)}
got:=Envelope(input,cmp)
if !reflect.DeepEqual(got,oracle(input)){t.Fatal("envelope")}
budget:=96*n*int(math.Ceil(math.Log2(float64(n+2))))
if calls>budget{t.Fatal("comparison budget",calls,budget)}

}
func TestStrataInteraction043(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
n:=4096;input:=make([]Span,n)
for i:=range input{input[i]=Span{-i,i+1,i%23,"x",i%2==0}}
calls:=0;cmp:=func(a,b int)int{calls++;return ordering(a,b)}
got:=Envelope(input,cmp)
if !reflect.DeepEqual(got,oracle(input)){t.Fatal("envelope")}
budget:=96*n*int(math.Ceil(math.Log2(float64(n+2))))
if calls>budget{t.Fatal("comparison budget",calls,budget)}

}
func TestStrataInteraction044(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
n:=4096;input:=make([]Span,n)
for i:=range input{input[i]=Span{i%17,n+i,i%23,"x",i%2==0}}
calls:=0;cmp:=func(a,b int)int{calls++;return ordering(a,b)}
got:=Envelope(input,cmp)
if !reflect.DeepEqual(got,oracle(input)){t.Fatal("envelope")}
budget:=96*n*int(math.Ceil(math.Log2(float64(n+2))))
if calls>budget{t.Fatal("comparison budget",calls,budget)}

}

func ordering(a,b int)int{if a<b{return -1};if a>b{return 1};return 0}
func oracle(input []Span) []Piece {
 var points []int
 for _,s:=range input {if s.Start<s.End{points=append(points,s.Start,s.End)}}
 sort.Ints(points)
 var out []Piece
 for i:=0;i+1<len(points);i++ {
  a,b:=points[i],points[i+1];if a==b{continue}
  best:=-1
  for j,s:=range input {if s.Start<=a&&a<s.End&&(best<0||s.Sequence>input[best].Sequence){best=j}}
  if best<0{continue}
  s:=input[best]
  if len(out)>0&&out[len(out)-1].End==a&&out[len(out)-1].Ordinal==best{out[len(out)-1].End=b}else{out=append(out,Piece{a,b,best,s.Sequence,s.Value,s.Tombstone})}
 }
 return out
}
func TestStrataBoundary000(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
input:=[]Span{{-5,0,-1,"x",false},{0,5,-1,"x",false},{-3,3,-1,"x",true},{2,2,99,"ignored",false},{8,4,100,"ignored",false}};got:=Envelope(input,ordering);if !reflect.DeepEqual(got,oracle(input)){t.Fatal(got)}
}
func TestStrataBoundary001(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
hi:=int(^uint(0)>>1);lo:= -hi-1;input:=[]Span{{lo,0,lo,"low",false},{0,hi,hi,"high",true},{-1,1,0,"mid",false}};got:=Envelope(input,ordering);if !reflect.DeepEqual(got,oracle(input)){t.Fatal(got)}
}
func TestStrataBoundary002(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
if out:=Envelope(nil,ordering);out!=nil{t.Fatal(out)};if out:=Envelope([]Span{{1,1,2,"x",false},{3,1,9,"y",false}},ordering);out!=nil{t.Fatal(out)}
}

func orderedOracle(input []Span,cmp Compare) []Piece {
 var points []int
 for _,span:=range input {if cmp(span.Start,span.End)<0{points=append(points,span.Start,span.End)}}
 sort.Slice(points,func(i,j int)bool{return cmp(points[i],points[j])<0})
 var out []Piece
 for i:=0;i+1<len(points);i++ {
  a,b:=points[i],points[i+1]
  if a==b{continue}
  best:=-1
  for j,span:=range input {if cmp(span.Start,a)<=0&&cmp(a,span.End)<0&&(best<0||cmp(span.Sequence,input[best].Sequence)>0){best=j}}
  if best<0{continue}
  winner:=input[best]
  if len(out)>0&&out[len(out)-1].End==a&&out[len(out)-1].Ordinal==best{out[len(out)-1].End=b}else{out=append(out,Piece{a,b,best,winner.Sequence,winner.Value,winner.Tombstone})}
 }
 return out
}
func TestStrataOpaqueOrder0(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

 encode:=func(rank int)int{return (rank*37+0*19)%101}
 ranks:=make(map[int]int)
 for rank:=0;rank<101;rank++{ranks[encode(rank)]=rank}
 raw:=func(a,b int)int{return ordering(ranks[a],ranks[b])}
 calls:=0
 measured:=func(a,b int)int{calls++;return raw(a,b)}
 var input []Span
 for i:=0;i<70;i++{input=append(input,Span{encode((i*17+0*11)%101),encode((i*43+0*7)%101),encode((i+0)%101),strconv.Itoa(i%3),i%2==0})}
 got:=Envelope(input,measured)
 if !reflect.DeepEqual(got,orderedOracle(input,raw)){t.Fatal("comparator order",got)}
 if calls>96*len(input)*int(math.Ceil(math.Log2(float64(len(input)+2)))){t.Fatal("comparison budget",calls)}
}
func TestStrataOpaqueOrder1(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

 encode:=func(rank int)int{return (rank*37+1*19)%101}
 ranks:=make(map[int]int)
 for rank:=0;rank<101;rank++{ranks[encode(rank)]=rank}
 raw:=func(a,b int)int{return ordering(ranks[a],ranks[b])}
 calls:=0
 measured:=func(a,b int)int{calls++;return raw(a,b)}
 var input []Span
 for i:=0;i<70;i++{input=append(input,Span{encode((i*17+1*11)%101),encode((i*43+1*7)%101),encode((i+1)%101),strconv.Itoa(i%3),i%2==0})}
 got:=Envelope(input,measured)
 if !reflect.DeepEqual(got,orderedOracle(input,raw)){t.Fatal("comparator order",got)}
 if calls>96*len(input)*int(math.Ceil(math.Log2(float64(len(input)+2)))){t.Fatal("comparison budget",calls)}
}
func TestStrataOpaqueOrder2(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

 encode:=func(rank int)int{return (rank*37+2*19)%101}
 ranks:=make(map[int]int)
 for rank:=0;rank<101;rank++{ranks[encode(rank)]=rank}
 raw:=func(a,b int)int{return ordering(ranks[a],ranks[b])}
 calls:=0
 measured:=func(a,b int)int{calls++;return raw(a,b)}
 var input []Span
 for i:=0;i<70;i++{input=append(input,Span{encode((i*17+2*11)%101),encode((i*43+2*7)%101),encode((i+2)%101),strconv.Itoa(i%3),i%2==0})}
 got:=Envelope(input,measured)
 if !reflect.DeepEqual(got,orderedOracle(input,raw)){t.Fatal("comparator order",got)}
 if calls>96*len(input)*int(math.Ceil(math.Log2(float64(len(input)+2)))){t.Fatal("comparison budget",calls)}
}
func TestStrataOpaqueOrder3(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

 encode:=func(rank int)int{return (rank*37+3*19)%101}
 ranks:=make(map[int]int)
 for rank:=0;rank<101;rank++{ranks[encode(rank)]=rank}
 raw:=func(a,b int)int{return ordering(ranks[a],ranks[b])}
 calls:=0
 measured:=func(a,b int)int{calls++;return raw(a,b)}
 var input []Span
 for i:=0;i<70;i++{input=append(input,Span{encode((i*17+3*11)%101),encode((i*43+3*7)%101),encode((i+3)%101),strconv.Itoa(i%3),i%2==0})}
 got:=Envelope(input,measured)
 if !reflect.DeepEqual(got,orderedOracle(input,raw)){t.Fatal("comparator order",got)}
 if calls>96*len(input)*int(math.Ceil(math.Log2(float64(len(input)+2)))){t.Fatal("comparison budget",calls)}
}
