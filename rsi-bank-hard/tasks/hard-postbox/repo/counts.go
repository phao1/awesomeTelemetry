package workspace
type Counts struct{Queued,InFlight,Waiting,IDs int}
func(b *Mailbox) Stats()Counts{
 waiting:=0
 for _,request:=range b.waiters{if request.state=="waiting"{waiting++}}
 return Counts{len(b.queue),len(b.held),waiting,len(b.ids)}
}
