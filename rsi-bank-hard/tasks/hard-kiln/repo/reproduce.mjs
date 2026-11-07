import {Workspace} from './workspace.mjs';
const w=new Workspace({aliases:{'@lib':'lib','@lib/ui':'widgets'}});
const files={'app':'use "@lib/ui/title"\ntake 0','widgets/title':'text "old"','lib/ui/title':'text "wrong"'};
const target=[{name:'web',entry:'app',output:'dist/site'}];
console.log(w.build(files,target).outputs);
files['widgets/title']='text "new"';
console.log(w.build(files,target).outputs);
console.log(w.build(files,[]).outputs);

const notes={'notes':'#text "tail"','notes#':'text "tail"'};
console.log(w.build(notes,[
  {name:'comment',entry:'notes',output:'dist/comment'},
  {name:'literal',entry:'notes#',output:'dist/literal'},
]).outputs);
