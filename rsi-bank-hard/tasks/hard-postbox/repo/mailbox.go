package workspace
type Message struct{ID,Body string}
type Delivery struct{ID,Body string;Token int;Error string}
type waiter struct{out chan Delivery;token int;state string}
type Mailbox struct{sim *Simulator;lease,next int;queue []Message;waiters []*waiter;held map[int]Message;ids map[string]bool;closed bool}
func NewMailbox(s *Simulator,lease int)*Mailbox{return &Mailbox{sim:s,lease:lease,held:make(map[int]Message),ids:make(map[string]bool)}}
func(b *Mailbox) Offer(id,body string)bool{if b.closed||b.ids[id]{return false};b.ids[id]=true;b.queue=append(b.queue,Message{id,body});b.pump();return true}
func(b *Mailbox) Pull()(<-chan Delivery,func()bool){w:=&waiter{out:make(chan Delivery,1),state:"waiting"};b.waiters=append(b.waiters,w);b.pump();return w.out,func()bool{if w.state=="done"{return false};w.state="done";return true}}
func(b *Mailbox) Ack(token int)bool{m,ok:=b.held[token];if !ok{return false};delete(b.held,token);delete(b.ids,m.ID);return true}
func(b *Mailbox) Nack(token int)bool{m,ok:=b.held[token];if !ok{return false};delete(b.held,token);b.queue=append(b.queue,m);b.pump();return true}
func(b *Mailbox) Close(){b.closed=true;b.queue=nil}
