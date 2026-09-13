/**
 * In-session multi-agent interaction graph (grok_dev).
 *
 * Derived purely on the client from the already-loaded slim event stream
 * plus the session identity — same constraints as `deriveTurns` (design D2/D3):
 * never persisted, never computed on the server, zero extra requests.
 *
 * Why this exists: `AgentHierarchyPanel` only renders *session-merge groups*
 * (`config/session-groups.json`). A single session that spawned Task /
 * subagent_prompt / Skill children therefore looks like one lonely "Main
 * agent" row, and the turn list is a flat ledger. DeepSeek Harness's
 * Trajectory + task-graph surfaces treat spawn / return / handoff as first
 * class edges. This module reconstructs that graph from the fields the
 * contract already gives us (`kind`, `tool`, `actor`, `title`, timestamps).
 *
 * Heuristic, not a vendor protocol. Callers must keep the criteria line
 * visible — same spirit as turn-key provenance.
 */

import { extractSubagentType } from './subagent-type.js';
import type {
  TraceEventSlim,
  TraceSession,
  TraceStatus,
  TurnModel,
} from './trace-types.js';

export type AgentNodeKind = 'main' | 'subagent';

export type AgentEdgeKind = 'spawn' | 'return' | 'handoff';

export const MAIN_AGENT_ID = 'main';

/** Tools that, across the nine adapters, mean "delegate to another agent". */
const SPAWN_TOOLS = new Set([
  'task',
  'agent',
  'subagent',
  'team',
  'workflow',
  'ralph',
  'skill',
  'delegate',
  'subagent_fork',
]);

/** OpenCode emits `kind: 'agent'` for every in-agent step (`agent step: …`). */
const OPENCODE_STEP_TITLE = /^agent step:/i;

export interface AgentGraphNode {
  id: string;
  label: string;
  kind: AgentNodeKind;
  /** Heuristic type (`Task`, `Explore`, actor name, …); `unknown` if none. */
  type: string;
  firstEventId: string | null;
  lastEventId: string | null;
  eventCount: number;
  toolCount: number;
  errorCount: number;
  durationMs: number;
  turnIndices: number[];
  status: TraceStatus;
}

export interface AgentGraphEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: AgentEdgeKind;
  eventId: string;
  turnIndex: number | null;
  title: string;
  status: TraceStatus;
}

export interface AgentLaneSpan {
  nodeId: string;
  eventId: string;
  title: string;
  kind: TraceEventSlim['kind'];
  startMs: number;
  endMs: number;
  status: TraceStatus;
  turnIndex: number | null;
}

export interface AgentGraph {
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
  spans: AgentLaneSpan[];
  /** Wall-clock window covering every dated event. */
  startMs: number;
  endMs: number;
  /** Σ event durations / wall-clock. > 1.2 ⇒ overlapping work. */
  parallelismRatio: number;
  spawnCount: number;
  /** True when the only node is the main agent. */
  singleAgent: boolean;
}

export interface DeriveAgentGraphInput {
  session: TraceSession;
  events: readonly TraceEventSlim[];
  /** Optional; used to stamp `turnIndex` on edges/spans for ribbon jump. */
  turns?: TurnModel | null;
}

function isSpawnEvent(event: TraceEventSlim): boolean {
  if (event.kind === 'subagent_prompt') {
    return true;
  }
  if (event.tool !== null && SPAWN_TOOLS.has(event.tool.toLowerCase())) {
    return true;
  }
  if (event.kind === 'agent' && !OPENCODE_STEP_TITLE.test(event.title)) {
    return true;
  }
  return false;
}

function labelForSpawn(event: TraceEventSlim): string {
  const actor = event.actor.trim();
  if (
    actor !== '' &&
    actor !== 'assistant' &&
    actor !== 'user' &&
    actor !== 'subagent' &&
    actor !== 'system'
  ) {
    return actor;
  }
  const fromTitle = extractSubagentType(event.title);
  if (fromTitle !== 'unknown') {
    return fromTitle;
  }
  if (event.tool !== null && event.tool !== '') {
    return event.tool;
  }
  const trimmed = event.title.trim();
  return trimmed === '' ? 'subagent' : trimmed.slice(0, 48);
}

function typeForSpawn(event: TraceEventSlim): string {
  const fromTitle = extractSubagentType(event.title);
  if (fromTitle !== 'unknown') {
    return fromTitle;
  }
  if (event.tool !== null && event.tool !== '') {
    return event.tool;
  }
  if (event.kind === 'subagent_prompt') {
    return 'subagent';
  }
  return 'unknown';
}

function eventStartMs(event: TraceEventSlim): number {
  const at = Date.parse(event.startedAt);
  return Number.isNaN(at) ? 0 : at;
}

function eventEndMs(event: TraceEventSlim): number {
  return eventStartMs(event) + Math.max(0, event.durationMs);
}

function worseStatus(a: TraceStatus, b: TraceStatus): TraceStatus {
  const rank: Record<TraceStatus, number> = {
    error: 4,
    running: 3,
    cancelled: 2,
    unknown: 1,
    success: 0,
  };
  return rank[a] >= rank[b] ? a : b;
}

function turnIndexForEvent(
  eventId: string,
  turns: TurnModel | null | undefined,
): number | null {
  if (turns === undefined || turns === null) {
    return null;
  }
  const index = turns.turns.findIndex((turn) =>
    turn.messages.some((message) => message.eventId === eventId),
  );
  return index >= 0 ? turns.turns[index]!.index : null;
}

interface MutableNode {
  id: string;
  label: string;
  kind: AgentNodeKind;
  type: string;
  firstEventId: string | null;
  lastEventId: string | null;
  eventCount: number;
  toolCount: number;
  errorCount: number;
  durationMs: number;
  turnIndices: Set<number>;
  status: TraceStatus;
}

function touchNode(
  node: MutableNode,
  event: TraceEventSlim,
  turnIndex: number | null,
): void {
  if (node.firstEventId === null) {
    node.firstEventId = event.id;
  }
  node.lastEventId = event.id;
  node.eventCount += 1;
  if (event.tool !== null) {
    node.toolCount += 1;
  }
  if (event.status === 'error') {
    node.errorCount += 1;
  }
  node.durationMs += Math.max(0, event.durationMs);
  node.status = worseStatus(node.status, event.status);
  if (turnIndex !== null) {
    node.turnIndices.add(turnIndex);
  }
}

function freezeNode(node: MutableNode): AgentGraphNode {
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    type: node.type,
    firstEventId: node.firstEventId,
    lastEventId: node.lastEventId,
    eventCount: node.eventCount,
    toolCount: node.toolCount,
    errorCount: node.errorCount,
    durationMs: node.durationMs,
    turnIndices: [...node.turnIndices].sort((a, b) => a - b),
    status: node.status,
  };
}

/**
 * Walk the sequence-ordered slim stream and emit nodes / edges / lane spans.
 *
 * Ownership rule:
 * - default owner is the main agent
 * - a spawn event opens a child and an edge `spawn`
 * - subsequent events attach to that child until the next spawn, a
 *   `user_prompt`, or end-of-stream
 * - a `user_prompt` (or stream end) closes the child with a `return` edge
 * - two consecutive spawns without a user prompt emit `handoff`
 */
export function deriveAgentGraph(input: DeriveAgentGraphInput): AgentGraph {
  const { session, events, turns } = input;
  const mainLabel =
    session.sourceAgent.trim() === '' ? session.title : session.sourceAgent;
  const main: MutableNode = {
    id: MAIN_AGENT_ID,
    label: session.isSubagent ? `${mainLabel} (sub)` : mainLabel,
    kind: session.isSubagent ? 'subagent' : 'main',
    type: session.isSubagent ? 'subagent' : 'main',
    firstEventId: null,
    lastEventId: null,
    eventCount: 0,
    toolCount: 0,
    errorCount: 0,
    durationMs: 0,
    turnIndices: new Set<number>(),
    status: session.status,
  };

  const nodes = new Map<string, MutableNode>([[MAIN_AGENT_ID, main]]);
  const edges: AgentGraphEdge[] = [];
  const spans: AgentLaneSpan[] = [];

  let currentId = MAIN_AGENT_ID;
  let spawnSeq = 0;
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = 0;

  const closeChild = (
    closer: TraceEventSlim,
    kind: 'return' | 'handoff',
    nextId: string,
  ): void => {
    if (currentId === MAIN_AGENT_ID) {
      return;
    }
    const child = nodes.get(currentId);
    if (child === undefined) {
      currentId = MAIN_AGENT_ID;
      return;
    }
    edges.push({
      id: `edge-${kind}-${closer.id}`,
      fromId: currentId,
      toId: nextId,
      kind,
      eventId: closer.id,
      turnIndex: turnIndexForEvent(closer.id, turns),
      title: closer.title,
      status: closer.status,
    });
    currentId = nextId;
  };

  for (const event of events) {
    const at = eventStartMs(event);
    if (at > 0) {
      startMs = Math.min(startMs, at);
      endMs = Math.max(endMs, eventEndMs(event));
    }
    const turnIndex = turnIndexForEvent(event.id, turns);

    if (event.kind === 'user_prompt' && currentId !== MAIN_AGENT_ID) {
      closeChild(event, 'return', MAIN_AGENT_ID);
    }

    if (isSpawnEvent(event)) {
      spawnSeq += 1;
      const childId = `spawn:${event.id}`;
      nodes.set(childId, {
        id: childId,
        label: labelForSpawn(event),
        kind: 'subagent',
        type: typeForSpawn(event),
        firstEventId: event.id,
        lastEventId: event.id,
        eventCount: 0,
        toolCount: 0,
        errorCount: 0,
        durationMs: 0,
        turnIndices: new Set<number>(),
        status: event.status,
      });
      if (currentId !== MAIN_AGENT_ID) {
        closeChild(event, 'handoff', childId);
      } else {
        edges.push({
          id: `edge-spawn-${event.id}`,
          fromId: MAIN_AGENT_ID,
          toId: childId,
          kind: 'spawn',
          eventId: event.id,
          turnIndex,
          title: event.title,
          status: event.status,
        });
        currentId = childId;
      }
    }

    const owner = nodes.get(currentId) ?? main;
    touchNode(owner, event, turnIndex);
    spans.push({
      nodeId: owner.id,
      eventId: event.id,
      title: event.title,
      kind: event.kind,
      startMs: at,
      endMs: eventEndMs(event),
      status: event.status,
      turnIndex,
    });
  }

  if (currentId !== MAIN_AGENT_ID) {
    const last = events[events.length - 1];
    if (last !== undefined) {
      closeChild(last, 'return', MAIN_AGENT_ID);
    }
  }

  const wallMs =
    Number.isFinite(startMs) && endMs > startMs ? endMs - startMs : 0;
  const summed = [...nodes.values()].reduce((sum, node) => sum + node.durationMs, 0);
  const parallelismRatio = wallMs > 0 ? summed / wallMs : 0;

  return {
    nodes: [...nodes.values()].map(freezeNode),
    edges,
    spans,
    startMs: Number.isFinite(startMs) ? startMs : 0,
    endMs,
    parallelismRatio,
    spawnCount: spawnSeq,
    singleAgent: spawnSeq === 0,
  };
}

export function agentNodeById(
  graph: AgentGraph,
  id: string,
): AgentGraphNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}
