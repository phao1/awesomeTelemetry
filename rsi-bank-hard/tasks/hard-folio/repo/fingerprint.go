package workspace
import (
 "crypto/sha256"
 "encoding/hex"
 "strconv"
)
func(a *Archive) Digest()string{
 hash:=sha256.New()
 for _,e:=range a.Entries(){
  for _,field:=range []string{e.Path,e.Kind,e.Target,strconv.Itoa(e.Mode),string(e.Body)}{
   hash.Write([]byte(strconv.Itoa(len([]byte(field)))+":"));hash.Write([]byte(field))
  }
 }
 return hex.EncodeToString(hash.Sum(nil))
}
