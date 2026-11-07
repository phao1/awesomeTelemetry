package workspace
import "testing"
func TestOneMessage(t *testing.T){s:=NewSimulator();b:=NewMailbox(s,5);b.Offer("a","hello");ch,_:=b.Pull();s.Drain();d:=<-ch;if d.Body!="hello"||!b.Ack(d.Token){t.Fatal(d)}}
