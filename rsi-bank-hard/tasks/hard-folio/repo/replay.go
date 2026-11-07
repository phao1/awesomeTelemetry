package workspace
import "encoding/json"
func(a *Archive) Replay(data []byte)error{var entries []Entry;if err:=json.Unmarshal(data,&entries);err!=nil{return err};return a.Apply(entries)}
