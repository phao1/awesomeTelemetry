package workspace
import "sort"
type Span struct { Start,End,Sequence int; Value string; Tombstone bool }
type Piece struct { Start,End,Ordinal int; Sequence int; Value string; Tombstone bool }
type Compare func(int,int) int
func Envelope(input []Span,compare Compare) []Piece {
 points:=make([]int,0,2*len(input))
 for _,s:=range input {if compare(s.Start,s.End)<0 {points=append(points,s.Start,s.End)}}
 sort.Slice(points,func(i,j int)bool{return compare(points[i],points[j])<0})
 var out []Piece
 for i:=0;i+1<len(points);i++ {
  a,b:=points[i],points[i+1];if a==b{continue};winner:=-1
  for j,s:=range input {if compare(s.Start,a)<=0&&compare(a,s.End)<0&&(winner<0||compare(s.Sequence,input[winner].Sequence)>0){winner=j}}
  if winner>=0 {s:=input[winner];if len(out)>0&&out[len(out)-1].End==a&&out[len(out)-1].Ordinal==winner{out[len(out)-1].End=b}else{out=append(out,Piece{a,b,winner,s.Sequence,s.Value,s.Tombstone})}}
 }
 return out
}
