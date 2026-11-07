package workspace
import "strings"
func pointer(text string) ([]string,error) { if text=="" {return nil,nil}; return strings.Split(strings.TrimPrefix(text,"/"),"/"),nil }
