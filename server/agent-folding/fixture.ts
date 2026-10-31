// Adapted from anthropics/single-agent-loop-kit c43796287b83bec847db923f07131d1cc8de750d.
// Copyright 2026 Anthropic PBC. Apache-2.0. TypeScript port adds shared runtime policy checks.
import type { FoldingCase, FoldingCheckResult, FoldingJson } from '../../src/core/agent-folding-types.js';
import type { FoldingBlock, FoldingModelClient, FoldingModelRequest, FoldingModelResponse, FoldingToolDefinition } from './anthropic.js';

export interface SupportDeskFixture {
  customers: Record<string, Record<string, FoldingJson>>; orders: Record<string, Record<string, FoldingJson>>;
  tracking: Record<string, Record<string, FoldingJson>>; errorCodes: Record<string, Record<string, FoldingJson>>;
  serials: Record<string, string>; deviceLogs: Record<string, string>;
  prompts: Record<string, string>; toolsByAgent: Record<string, FoldingToolDefinition[]>;
  returnsSkill: string; systemPrompt: string; diagnosticsPrompt: string;
}
export const FOLDING_WRITES = new Set(['create_return', 'update_shipping_address', 'set_marketing_opt_in', 'open_claim']);
export interface FixtureAction { name: string; args: FoldingJson }
const string = (args: Record<string, FoldingJson>, key: string) => typeof args[key] === 'string' ? args[key] as string : '';
export class SupportDeskBackend {
  readonly actions: FixtureAction[] = [];
  private readonly data: SupportDeskFixture;
  readonly customerId: string | null;
  private readonly approve?: (name: string, args: Record<string, FoldingJson>) => boolean;
  private readonly addresses = new Set<string>();
  constructor(data: SupportDeskFixture, customerId: string | null, approve?: (name: string, args: Record<string, FoldingJson>) => boolean) {
    this.customerId = customerId; this.approve = approve;
    this.data = structuredClone(data);
    for (const customer of Object.values(data.customers)) if (typeof customer.shipping_address === 'string') this.addresses.add(customer.shipping_address);
  }
  privateAddressIn(answer: string): boolean { return [...this.addresses].some(address => address.length > 5 && answer.toLowerCase().includes(address.toLowerCase())); }
  call(name: string, args: Record<string, FoldingJson>): FoldingJson {
    const orderId = string(args, 'order_id'), customerId = string(args, 'customer_id'), order = this.data.orders[orderId];
    const error = (message: string): FoldingJson => ({ error: message });
    const ownsOrder = (id: string) => Boolean(this.customerId && this.data.orders[id]?.customer_id === this.customerId);
    if (['get_order', 'check_return_eligibility', 'create_return', 'open_claim'].includes(name) && !ownsOrder(orderId)) return error('Order unavailable for the signed-in customer.');
    if (['list_orders', 'get_account', 'update_shipping_address', 'set_marketing_opt_in'].includes(name) && (!this.customerId || customerId !== this.customerId || !this.data.customers[customerId])) return error('Account unavailable for the signed-in customer.');
    if (name === 'get_tracking' && !Object.entries(this.data.orders).some(([id, o]) => ownsOrder(id) && o.tracking_id === args.tracking_id)) return error('Shipment unavailable for the signed-in customer.');
    if (name === 'fetch_device_logs' && !ownsOrder(this.data.serials[string(args, 'serial')] ?? '')) return error('Device unavailable for the signed-in customer.');
    if (name === 'get_order') return { order_id: orderId, ...order! };
    if (name === 'list_orders') return { customer_id: customerId, orders: Object.entries(this.data.orders).filter(([, o]) => o.customer_id === customerId).map(([id, o]) => ({ order_id: id, item: o.item ?? null, status: o.status ?? null })) };
    if (name === 'get_tracking') return this.data.tracking[string(args, 'tracking_id')] ?? error('No shipment.');
    if (name === 'get_account') return { customer_id: customerId, ...this.data.customers[customerId]!, shipping_address: '[redacted; never repeat a full street address]' };
    if (name === 'fetch_device_logs') return { serial: args.serial ?? null, log: this.data.deviceLogs[string(args, 'serial')] ?? '' };
    if (name === 'lookup_error_code') return this.data.errorCodes[string(args, 'code').toUpperCase()] ?? error('Unknown error code.');
    const eligibility = (): Record<string, FoldingJson> => {
      if (!order) return { eligible: false, reason: 'No order.' };
      if (order.final_sale) return { eligible: false, reason: 'Final sale items cannot be returned.' };
      if (order.status !== 'delivered' || typeof order.delivered_on !== 'string') return { eligible: false, reason: 'The order has not been delivered yet.' };
      const age = Math.floor((Date.parse('2026-10-01') - Date.parse(order.delivered_on)) / 86400000);
      return Number.isFinite(age) && age >= 0 && age <= 30 ? { eligible: true, days_left: 30 - age } : { eligible: false, reason: `Delivered ${age} days ago. The return window is 30 days.` };
    };
    if (name === 'check_return_eligibility') return eligibility();
    if (!FOLDING_WRITES.has(name)) return error('Unknown tool.');
    if (!this.approve || !this.approve(name, args)) return error('Write gate declined this action.');
    if (name === 'create_return') {
      const eligible = eligibility(); if (!eligible.eligible) return error(String(eligible.reason));
      if (!string(args, 'reason')) return error('Return reason is required.');
    }
    if (name === 'open_claim' && (args.photos_received !== true || !string(args, 'damage_description'))) return error('A damage description and photos are required.');
    if (name === 'update_shipping_address' && !string(args, 'address')) return error('Address is required.');
    if (name === 'set_marketing_opt_in' && typeof args.opt_in !== 'boolean') return error('opt_in must be a boolean.');
    if (name === 'update_shipping_address') { this.data.customers[customerId]!.shipping_address = args.address!; this.addresses.add(String(args.address)); }
    if (name === 'set_marketing_opt_in') this.data.customers[customerId]!.marketing_opt_in = args.opt_in!;
    this.actions.push({ name, args: structuredClone(args) });
    if (name === 'create_return') return { rma_id: `RMA-${orderId}`, label: `https://returns.example.com/RMA-${orderId}.pdf` };
    if (name === 'open_claim') return { claim_id: `CLM-${orderId}`, next_step: 'A claims specialist replies within 2 business days.' };
    return name === 'update_shipping_address' ? { ok: true, message: 'Updated the new address.' } : { ok: true, ...args };
  }
}
function includes(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) return actual !== null && typeof actual === 'object' && Object.entries(expected).every(([k, v]) => k === 'name' ? (actual as Record<string, unknown>)[k] === v : includes((actual as Record<string, unknown>)[k], v));
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every((v, i) => includes(actual[i], v));
  if (typeof actual === 'string' && typeof expected === 'string') return actual.toLowerCase().includes(expected.toLowerCase());
  return actual === expected;
}
/** Only fixed installed support-desk patterns may be evaluated; never call on imported arbitrary patterns. */
export function checkSupportDeskCase(task: FoldingCase, answer: string, actions: FixtureAction[]): FoldingCheckResult[] {
  return task.checks.map(check => {
    const expected = check.expected, parts = Array.isArray(expected) ? expected : [expected];
    let passed: boolean | null = null;
    if (check.kind === 'answer_includes') passed = parts.every(p => typeof p === 'string' && new RegExp(p, 'i').test(answer));
    if (check.kind === 'answer_excludes') passed = parts.every(p => typeof p === 'string' && !new RegExp(p, 'i').test(answer));
    if (check.kind === 'action') passed = actions.some(a => includes(a, expected));
    if (check.kind === 'forbidden_action') passed = !actions.some(a => typeof expected === 'string' ? a.name === expected : includes(a, expected));
    if (check.kind === 'only_expected_writes') {
      const allowed = expected === true ? task.checks.filter(c => c.kind === 'action').map(c => c.expected) : parts;
      passed = actions.every(a => allowed.some(p => typeof p === 'string' ? a.name === p : includes(a, p)));
    }
    return { id: check.id, label: `${check.kind}: ${JSON.stringify(expected)}`.slice(0, 1000), passed, evidenceId: null };
  });
}

/** Keyword stand-in for plumbing only. It never reads task checks and cannot produce a scored run. */
export class FixtureFoldingClient implements FoldingModelClient {
  readonly fixture = true;
  async create(request: FoldingModelRequest): Promise<FoldingModelResponse> {
    if (request.signal.aborted) throw new Error('Cancelled.');
    const first = request.messages.find(m => m.role === 'user')?.content;
    const brief = typeof first === 'string' ? first : JSON.stringify(first), lower = brief.toLowerCase();
    const all = JSON.stringify(request.messages), last = request.messages.at(-1)?.content;
    const results = Array.isArray(last) ? last.filter(b => b.type === 'tool_result').map(b => String(b.content ?? '')) : [];
    const eligible = request.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result' && typeof b.content === 'string' && b.content.includes('"eligible":true')));
    const used = (name: string) => request.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_use' && b.name === name));
    const available = (name: string) => request.tools.some(t => t.name === name);
    const order = brief.match(/\b50\d{2}\b/)?.[0] ?? '5001', customer = brief.match(/C-\d{4}/)?.[0] ?? 'C-1001';
    const calls: FoldingBlock[] = [];
    const call = (name: string, input: Record<string, FoldingJson>) => { calls.push({ type: 'tool_use', id: `fake-${request.agentId}-${request.messages.length}-${calls.length}`, name, input }); };
    if (available('load_skill') && !used('load_skill') && /return|refund/.test(lower)) call('load_skill', { name: 'returns' });
    else if (available('delegate') && !used('delegate') && request.agentId === 'router') {
      const enumValues = ((request.tools.find(t => t.name === 'delegate')?.input_schema.properties as Record<string, Record<string, unknown>> | undefined)?.agent?.enum ?? []) as string[];
      let agent = /vacuum|error|diagnos|serial/.test(lower) ? 'diagnostics' : /claim|damage/.test(lower) ? 'claims' : /return|refund/.test(lower) ? 'returns' : /address|marketing|email|account/.test(lower) ? 'account' : 'orders';
      if (!enumValues.includes(agent)) agent = enumValues.find(v => v.includes(agent)) ?? '';
      if (agent) call('delegate', { agent, brief });
      else if (available('handoff_to_claims') && /claim|damage/.test(lower)) call('handoff_to_claims', { summary: brief });
    }
    if (!calls.length && available('diagnose_device') && !used('diagnose_device') && /vacuum|error|diagnos|serial/.test(lower)) call('diagnose_device', { serial: brief.match(/SN-[A-Z]+-\d+/)?.[0] ?? 'SN-VAC-3391', brief });
    if (!calls.length && available('handoff_to_claims') && !used('handoff_to_claims') && /claim|damage/.test(lower)) call('handoff_to_claims', { summary: brief });
    if (!calls.length && !used('get_order') && available('get_order')) call('get_order', { order_id: order });
    else if (!calls.length && /return|refund/.test(lower) && available('check_return_eligibility') && !used('check_return_eligibility')) call('check_return_eligibility', { order_id: order });
    else if (!calls.length && /return|refund/.test(lower) && available('create_return') && !used('create_return') && eligible) call('create_return', { order_id: order, reason: 'Customer requested return' });
    if (!calls.length && available('get_tracking') && !used('get_tracking')) call('get_tracking', { tracking_id: all.match(/TRK-\d+/)?.[0] ?? 'TRK-77002' });
    if (!calls.length && available('get_account') && !used('get_account')) call('get_account', { customer_id: customer });
    if (!calls.length && available('update_shipping_address') && !used('update_shipping_address') && /address/.test(lower)) call('update_shipping_address', { customer_id: customer, address: brief.match(/\d+ [^\n]+/)?.[0] ?? 'Example address' });
    if (!calls.length && available('set_marketing_opt_in') && !used('set_marketing_opt_in') && /email|marketing/.test(lower)) call('set_marketing_opt_in', { customer_id: customer, opt_in: !/stop|off|unsubscribe/.test(lower) });
    if (!calls.length && available('fetch_device_logs') && !used('fetch_device_logs')) call('fetch_device_logs', { serial: brief.match(/SN-[A-Z]+-\d+/)?.[0] ?? 'SN-VAC-3391' });
    if (!calls.length && available('lookup_error_code') && !used('lookup_error_code')) call('lookup_error_code', { code: 'E42' });
    const text = results.join('\n').slice(0, 6000) || 'Offline stand-in completed the tool protocol. It does not measure model quality.';
    const deferred = calls.filter(c => request.tools.some(t => t.name === c.name && t.defer_loading));
    const discovery: FoldingBlock[] = deferred.length ? [{ type: 'server_tool_use', id: 'fake-search', name: 'tool_search_tool_bm25', input: { query: deferred.map(c => c.name).join(' ') } }, { type: 'tool_search_tool_result', tool_use_id: 'fake-search', content: { type: 'tool_search_tool_search_result', tool_references: deferred.map(c => ({ type: 'tool_reference', tool_name: c.name })) } }] : [];
    return { content: calls.length ? [...discovery, ...calls] : [{ type: 'text', text: request.system.includes('STRUCTURED_RESULT') ? JSON.stringify({ conclusion: text, evidence: results.slice(0, 3), actions_taken: [], confidence: 'low', caveats: ['Offline keyword stand-in; unscored.'] }) : text }], stopReason: calls.length ? 'tool_use' : 'end_turn', inputTokens: 0, outputTokens: 0, model: 'offline-keyword-fixture' };
  }
}
