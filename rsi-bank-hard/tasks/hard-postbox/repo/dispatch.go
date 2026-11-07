package workspace
func (b *Mailbox) pump(){
 for len(b.waiters)>0&&len(b.queue)>0 {
  w:=b.waiters[0];b.waiters=b.waiters[1:]
  message:=b.queue[0];b.queue=b.queue[1:]
  b.next++;token:=b.next
  b.held[token]=message;w.token=token
  b.sim.After(0,func(){w.out<-Delivery{message.ID,message.Body,token,""}})
  b.sim.After(b.lease,func(){if m,ok:=b.held[token];ok{delete(b.held,token);b.queue=append(b.queue,m);b.pump()}})
 }
}
