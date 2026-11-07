package workspace
import "strings"
func descendant(base,name string)bool{return strings.HasPrefix(name,base)}
