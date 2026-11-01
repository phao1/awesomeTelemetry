import type { Database } from 'better-sqlite3';
import { TASK_BINDINGS_SQL } from './task-workbench.js';
import { cachedStmt } from './stmt-cache.js';
import type { HomeHydrationMember } from '../watch/task-home-hydrator.js';

/** Metadata only, one cached batch; no path or body escapes to a client. */
export function taskHomeMembers(db: Database, taskIds: string[]): HomeHydrationMember[] {
  const roots = JSON.stringify(taskIds.map(id => id.slice('collected:'.length)));
  const rows = cachedStmt(db, `${TASK_BINDINGS_SQL}
    SELECT root_id,id,detail_loaded FROM (
      SELECT b.root_id,s.id,s.detail_loaded,
        ROW_NUMBER() OVER (PARTITION BY b.root_id ORDER BY s.id) AS member_row
      FROM bindings b JOIN sessions s ON s.id=b.session_id
      WHERE b.root_id IN (SELECT value FROM json_each(?))
    ) WHERE member_row<=100 ORDER BY root_id,id LIMIT 5000`).all(roots) as Array<{root_id:string;id:string;detail_loaded:number}>;
  return rows.map(row => ({taskId:'collected:'+row.root_id,key:row.id,loaded:row.detail_loaded===1}));
}
