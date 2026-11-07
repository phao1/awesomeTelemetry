package workspace
import "testing"
func TestBasicObject(t *testing.T) {
 out,err:=Apply(map[string]any{},[]Operation{{Op:"add",Path:"/x",Value:float64(2)}})
 if err!=nil || out.(map[string]any)["x"]!=float64(2) {t.Fatal(out,err)}
}
