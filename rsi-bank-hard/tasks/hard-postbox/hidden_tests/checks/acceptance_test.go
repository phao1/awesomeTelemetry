package checks
import (
"testing"
. "workspace"

)
func TestPostboxInteraction000(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,1);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction001(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,0);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 0>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(0)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 0>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction002(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,2);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction003(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,1);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 1>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(1)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 1>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction004(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,3);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction005(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,2);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 2>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(2)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 2>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction006(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,4);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction007(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,3);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 3>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(3)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 3>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction008(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction009(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,4);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 4>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(4)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 4>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction010(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,6);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction011(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 5>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(5)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 5>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction012(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,7);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction013(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,6);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 6>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(6)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 6>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction014(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,8);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction015(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,7);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 7>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(7)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 7>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction016(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,9);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction017(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,8);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 8>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(8)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 8>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction018(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,10);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction019(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,9);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 9>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(9)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 9>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction020(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,11);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction021(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,10);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 10>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(10)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 10>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction022(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,12);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction023(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,11);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 11>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(11)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 11>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction024(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,13);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction025(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,12);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 12>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(12)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 12>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction026(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,14);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction027(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,13);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 13>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(13)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 13>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction028(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,15);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction029(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,14);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 14>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(14)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 14>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction030(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,16);b.Offer("a","body");first,cancel:=b.Pull();second,_:=b.Pull()
if !cancel()||cancel(){t.Fatal("cancel identity")}
s.Drain();empty(t,first);d:=take(t,second)
if d.ID!="a"||d.Body!="body"||d.Token!=2{t.Fatal(d)}
if b.Ack(1)||!b.Ack(d.Token)||b.Ack(d.Token){t.Fatal("generation")}
if !b.Offer("a","new"){t.Fatal("ID leak")}

}
func TestPostboxInteraction031(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,15);b.Offer("a","body");ch,cancel:=b.Pull();s.Advance(20)
ids:=s.Ready();if len(ids)!=1{t.Fatal("lease began before delivery",ids)};_ = s.Step(ids[0]);d:=take(t,ch)
if cancel(){t.Fatal("cancel published")}
if 15>0{if len(s.Ready())!=0{t.Fatal("early expiry")};s.Advance(15)}
next,_:=b.Pull();s.Drain();r:=take(t,next)
if r.Token<=d.Token||r.ID!="a"||b.Ack(d.Token){t.Fatal(d,r)}
if 15>0&&!b.Ack(r.Token){t.Fatal("new ack")}

}
func TestPostboxInteraction032(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");ch,_:=b.Pull()

b.Close();b.Close()

s.Drain()
if 0!=0{d:=take(t,ch);if d.Error!=""||!b.Ack(d.Token){t.Fatal(d)}}else if 0==0{if take(t,ch).Error!="closed"{t.Fatal("close")}}else{empty(t,ch)}
a,stop:=b.Pull();_ = stop;s.Drain()
if 0==0{if take(t,a).Error!="closed"{t.Fatal("after close")}}else{empty(t,a)}
if b.Offer("b","B"){t.Fatal("offer after close")}

}
func TestPostboxInteraction033(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");ch,_:=b.Pull()
s.Drain()
b.Close();b.Close()

s.Drain()
if 1!=0{d:=take(t,ch);if d.Error!=""||!b.Ack(d.Token){t.Fatal(d)}}else if 0==0{if take(t,ch).Error!="closed"{t.Fatal("close")}}else{empty(t,ch)}
a,stop:=b.Pull();_ = stop;s.Drain()
if 0==0{if take(t,a).Error!="closed"{t.Fatal("after close")}}else{empty(t,a)}
if b.Offer("b","B"){t.Fatal("offer after close")}

}
func TestPostboxInteraction034(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");ch,cancel:=b.Pull()

b.Close();b.Close()
cancel()
s.Drain()
if 0!=0{d:=take(t,ch);if d.Error!=""||!b.Ack(d.Token){t.Fatal(d)}}else if 2==0{if take(t,ch).Error!="closed"{t.Fatal("close")}}else{empty(t,ch)}
a,stop:=b.Pull();_ = stop;s.Drain()
if 0==0{if take(t,a).Error!="closed"{t.Fatal("after close")}}else{empty(t,a)}
if b.Offer("b","B"){t.Fatal("offer after close")}

}
func TestPostboxInteraction035(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");ch,cancel:=b.Pull()
s.Drain()
b.Close();b.Close()
cancel()
s.Drain()
if 1!=0{d:=take(t,ch);if d.Error!=""||!b.Ack(d.Token){t.Fatal(d)}}else if 2==0{if take(t,ch).Error!="closed"{t.Fatal("close")}}else{empty(t,ch)}
a,stop:=b.Pull();_ = stop;s.Drain()
if 0==0{if take(t,a).Error!="closed"{t.Fatal("after close")}}else{empty(t,a)}
if b.Offer("b","B"){t.Fatal("offer after close")}

}
func TestPostboxInteraction036(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");ch,_:=b.Pull()

b.Close();b.Close()

s.Drain()
if 0!=0{d:=take(t,ch);if d.Error!=""||!b.Ack(d.Token){t.Fatal(d)}}else if 0==0{if take(t,ch).Error!="closed"{t.Fatal("close")}}else{empty(t,ch)}
a,stop:=b.Pull();stop();s.Drain()
if 4==0{if take(t,a).Error!="closed"{t.Fatal("after close")}}else{empty(t,a)}
if b.Offer("b","B"){t.Fatal("offer after close")}

}
func TestPostboxInteraction037(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");ch,_:=b.Pull()
s.Drain()
b.Close();b.Close()

s.Drain()
if 1!=0{d:=take(t,ch);if d.Error!=""||!b.Ack(d.Token){t.Fatal(d)}}else if 0==0{if take(t,ch).Error!="closed"{t.Fatal("close")}}else{empty(t,ch)}
a,stop:=b.Pull();stop();s.Drain()
if 4==0{if take(t,a).Error!="closed"{t.Fatal("after close")}}else{empty(t,a)}
if b.Offer("b","B"){t.Fatal("offer after close")}

}
func TestPostboxInteraction038(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");ch,cancel:=b.Pull()

b.Close();b.Close()
cancel()
s.Drain()
if 0!=0{d:=take(t,ch);if d.Error!=""||!b.Ack(d.Token){t.Fatal(d)}}else if 2==0{if take(t,ch).Error!="closed"{t.Fatal("close")}}else{empty(t,ch)}
a,stop:=b.Pull();stop();s.Drain()
if 4==0{if take(t,a).Error!="closed"{t.Fatal("after close")}}else{empty(t,a)}
if b.Offer("b","B"){t.Fatal("offer after close")}

}
func TestPostboxInteraction039(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");ch,cancel:=b.Pull()
s.Drain()
b.Close();b.Close()
cancel()
s.Drain()
if 1!=0{d:=take(t,ch);if d.Error!=""||!b.Ack(d.Token){t.Fatal(d)}}else if 2==0{if take(t,ch).Error!="closed"{t.Fatal("close")}}else{empty(t,ch)}
a,stop:=b.Pull();stop();s.Drain()
if 4==0{if take(t,a).Error!="closed"{t.Fatal("after close")}}else{empty(t,a)}
if b.Offer("b","B"){t.Fatal("offer after close")}

}
func TestPostboxInteraction040(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");b.Offer("b","B");a,_:=b.Pull();s.Drain();d:=take(t,a);if !b.Nack(d.Token){t.Fatal("nack")};x,_:=b.Pull();y,_:=b.Pull();s.Drain();if take(t,x).ID!="b"||take(t,y).ID!="a"{t.Fatal("FIFO")};if b.Nack(d.Token){t.Fatal("duplicate nack")}
}
func TestPostboxInteraction041(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");ch,_:=b.Pull();if b.Ack(1)||b.Nack(1){t.Fatal("reserved ack")};if b.Offer("a","duplicate"){t.Fatal("duplicate")};s.Drain();d:=take(t,ch);b.Close();if !b.Nack(d.Token){t.Fatal("closed nack")};s.Advance(10);s.Drain();closedResult,_:=b.Pull();s.Drain();if take(t,closedResult).Error!="closed"{t.Fatal("closed requeue")}
}
func TestPostboxInteraction042(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);a,stop:=b.Pull();if !stop(){t.Fatal("waiting cancel")};b.Offer("a","A");z,_:=b.Pull();s.Drain();empty(t,a);if take(t,z).ID!="a"{t.Fatal("lost") }
}
func TestPostboxInteraction043(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");a,_:=b.Pull();s.Drain();d:=take(t,a);s.Advance(5);if !b.Ack(d.Token){t.Fatal("ack wins")};s.Drain();if !b.Offer("a","new"){t.Fatal("id") }
}
func TestPostboxInteraction044(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");a,_:=b.Pull();s.Drain();d:=take(t,a);s.Advance(5);s.Drain();if b.Ack(d.Token){t.Fatal("expiry wins")};z,_:=b.Pull();s.Drain();if take(t,z).Token==d.Token{t.Fatal("stale") }
}

func take(t *testing.T,ch <-chan Delivery)Delivery{t.Helper();select{case d:=<-ch:return d;default:t.Fatal("no delivery");return Delivery{}}}
func empty(t *testing.T,ch <-chan Delivery){t.Helper();select{case d:=<-ch:t.Fatal("unexpected delivery",d);default:}}
func TestPostboxReadyOrder000(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{0,1,2,3}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder001(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{0,1,3,2}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder002(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{0,2,1,3}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder003(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{0,2,3,1}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder004(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{0,3,1,2}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder005(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{0,3,2,1}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder006(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{1,0,2,3}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder007(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{1,0,3,2}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder008(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{1,2,0,3}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder009(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{1,2,3,0}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder010(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{1,3,0,2}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder011(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{1,3,2,0}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder012(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{2,0,1,3}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder013(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{2,0,3,1}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder014(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{2,1,0,3}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder015(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{2,1,3,0}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder016(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{2,3,0,1}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder017(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{2,3,1,0}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder018(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{3,0,1,2}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder019(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{3,0,2,1}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder020(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{3,1,0,2}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder021(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{3,1,2,0}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder022(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{3,2,0,1}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxReadyOrder023(t *testing.T) {
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()

s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","old");ch,_:=b.Pull();s.Drain();d:=take(t,ch);s.Advance(5)
expiry:=s.Ready()[0]
held:=true;queued:="";accepted:=false
for _,action:=range []int{3,2,1,0}{
 switch action{
 case 0:
  if held{held=false;queued="old"}
  if len(s.Ready())>0{_ = s.Step(expiry)}
 case 1:
  expected:=held
  if b.Ack(d.Token)!=expected{t.Fatal("ack order")}
  held=false
 case 2:
  expected:=held
  if b.Nack(d.Token)!=expected{t.Fatal("nack order")}
  if held{held=false;queued="old"}
 case 3:
  expected:=!held&&queued==""
  accepted=b.Offer("a","new")
  if accepted!=expected{t.Fatal("offer order",accepted,expected)}
  if accepted{queued="new"}
 }
}
next,cancel:=b.Pull();s.Drain()
if queued==""{empty(t,next);cancel()}else{out:=take(t,next);if out.Body!=queued||out.Token<=d.Token{t.Fatal(out,queued)}}
}
func TestPostboxAccounting0(t *testing.T){
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");ch,_:=b.Pull();if b.Stats()!=(Counts{InFlight:1,IDs:1}){t.Fatal(b.Stats())};s.Drain();d:=take(t,ch);b.Close();if b.Stats()!=(Counts{InFlight:1,IDs:1}){t.Fatal(b.Stats())};b.Nack(d.Token);if b.Stats()!=(Counts{}){t.Fatal(b.Stats())};s.Advance(5);s.Drain();if b.Stats()!=(Counts{}){t.Fatal(b.Stats())}
}
func TestPostboxAccounting1(t *testing.T){
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");b.Offer("b","B");ch,_:=b.Pull();b.Close();if b.Stats()!=(Counts{}){t.Fatal(b.Stats())};s.Drain();if take(t,ch).Error!="closed"{t.Fatal("close")};if b.Stats()!=(Counts{}){t.Fatal(b.Stats())}
}
func TestPostboxAccounting2(t *testing.T){
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);_,cancel:=b.Pull();if b.Stats()!=(Counts{Waiting:1}){t.Fatal(b.Stats())};cancel();if b.Stats()!=(Counts{}){t.Fatal(b.Stats())};b.Offer("a","A");if b.Stats()!=(Counts{Queued:1,IDs:1}){t.Fatal(b.Stats())}
}
func TestPostboxAccounting3(t *testing.T){
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","A");ch,_:=b.Pull();s.Drain();_ = take(t,ch);b.Close();s.Advance(5);s.Drain();if b.Stats()!=(Counts{}){t.Fatal(b.Stats())}
}
func TestPostboxAccounting4(t *testing.T){
 defer func(){if problem:=recover();problem!=nil{t.Fatalf("unexpected panic: %v",problem)}}()
observed:=false;func(){defer func(){if recover()!=nil{observed=true}}();_ = NewMailbox(NewSimulator(),-1)}();if !observed{t.Fatal("negative lease must panic")}
}
