package workspace
import "fmt"
type job struct { at int; run func() }
type Simulator struct { Now int; next int; lanes map[int]chan job }
func NewSimulator()*Simulator{return &Simulator{lanes:make(map[int]chan job)}}
func(s *Simulator) After(delay int,run func())int{s.next++;lane:=make(chan job,1);lane<-job{s.Now+delay,run};s.lanes[s.next]=lane;return s.next}
func(s *Simulator) Ready()[]int{var out []int;for id:=1;id<=s.next;id++{lane:=s.lanes[id];if lane==nil{continue};j:=<-lane;lane<-j;if j.at<=s.Now{out=append(out,id)}};return out}
func(s *Simulator) Step(id int)error{lane:=s.lanes[id];if lane==nil{return fmt.Errorf("job")};j:=<-lane;if j.at>s.Now{lane<-j;return fmt.Errorf("future")};delete(s.lanes,id);j.run();return nil}
func(s *Simulator) Cancel(id int){delete(s.lanes,id)}
func(s *Simulator) Advance(delta int){if delta<0{panic("time")};s.Now+=delta}
func(s *Simulator) Drain(){for n:=0;n<10000;n++{ids:=s.Ready();if len(ids)==0{return};_ = s.Step(ids[0])};panic("livelock")}
