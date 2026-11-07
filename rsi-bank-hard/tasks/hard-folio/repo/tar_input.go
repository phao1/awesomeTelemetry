package workspace
import (
 "archive/tar"
 "bytes"
 "fmt"
 "io"
)
func(a *Archive) Import(data []byte)error{
 reader:=tar.NewReader(bytes.NewReader(data));var entries []Entry
 for{
  h,err:=reader.Next();if err==io.EOF{break};if err!=nil{return err}
  e:=Entry{Path:h.Name,Mode:int(h.Mode),Target:h.Linkname}
  switch h.Typeflag{
  case tar.TypeReg,tar.TypeRegA:e.Kind="file";e.Body,err=io.ReadAll(reader);if err!=nil{return err}
  case tar.TypeDir:e.Kind="dir"
  case tar.TypeSymlink:e.Kind="symlink"
  case tar.TypeLink:e.Kind="hardlink"
  default:return fmt.Errorf("unsupported tar entry")
  }
  entries=append(entries,e)
 }
 return a.Apply(entries)
}
