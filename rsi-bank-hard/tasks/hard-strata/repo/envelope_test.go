package workspace
import "testing"
func TestPlainSpan(t *testing.T){out:=Envelope([]Span{{0,3,1,"x",false}},func(a,b int)int{if a<b{return -1};if a>b{return 1};return 0});if len(out)!=1||out[0].End!=3{t.Fatal(out)}}
