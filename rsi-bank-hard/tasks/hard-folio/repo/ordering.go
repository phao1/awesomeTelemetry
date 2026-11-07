package workspace
import (
 "sort"
 "strings"
)
func ordered(names []string){sort.SliceStable(names,func(i,j int)bool{return strings.ToLower(names[i])<strings.ToLower(names[j])})}
