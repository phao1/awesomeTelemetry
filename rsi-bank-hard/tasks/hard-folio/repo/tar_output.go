package workspace
import (
 "archive/tar"
 "bytes"
)
func(a *Archive) Tar()([]byte,error){
 var output bytes.Buffer
 writer:=tar.NewWriter(&output)
 for _,e:=range a.Entries(){
  header:=&tar.Header{Name:e.Path,Mode:int64(e.Mode),Format:tar.FormatPAX}
  switch e.Kind{
  case "file":header.Typeflag=tar.TypeReg;header.Size=int64(len(e.Body))
  case "dir":header.Typeflag=tar.TypeDir
  case "symlink":header.Typeflag=tar.TypeSymlink;header.Linkname=e.Target
  case "hardlink":header.Typeflag=tar.TypeLink;header.Linkname=e.Target
  }
  if err:=writer.WriteHeader(header);err!=nil{return nil,err}
  if e.Kind=="file"{if _,err:=writer.Write(e.Body);err!=nil{return nil,err}}
 }
 if err:=writer.Close();err!=nil{return nil,err};return output.Bytes(),nil
}
