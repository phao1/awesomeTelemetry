import Database from 'better-sqlite3';
import {expect,it} from 'vitest';
import {initSchema} from './schema.js';
import {taskHomeMembers} from './task-home-members.js';
it('resolves only the requested page in a single metadata batch, retaining loaded flags and bounding members',()=>{
 const queries:string[]=[],db=new Database(':memory:',{verbose:sql=>queries.push(String(sql))});initSchema(db);
 try{
 const session=db.prepare("INSERT INTO sessions(id,provider,source_agent,source_path,started_at,updated_at,detail_loaded) VALUES(?,'codex','Codex','/not-read','2026-10-31T00:00:00Z','2026-10-31T00:00:00Z',?)");session.run('root',0);session.run('child',1);session.run('other',0);
 db.prepare("INSERT INTO team_runs(id,provider,native_run_id,updated_at,stamp) VALUES('run','codex','root','2026-10-31T00:00:00Z','s')").run();
 const agent=db.prepare("INSERT INTO team_agents(id,run_id,native_id,display_name,role_class,session_keys_json) VALUES(?,'run',?,?,?,?)");agent.run('a','root','Main','leader','["root"]');agent.run('b','child','Child','subagent','["child"]');
 queries.length=0;expect(taskHomeMembers(db,['collected:root'])).toEqual([{taskId:'collected:root',key:'child',loaded:true},{taskId:'collected:root',key:'root',loaded:false}]);
 expect(queries).toHaveLength(1);expect(queries[0]).not.toMatch(/input_summary|output_summary|event_raw|source_path/);
 }finally{db.close();}
});
