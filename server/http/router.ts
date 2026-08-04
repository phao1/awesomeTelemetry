import type { IncomingMessage, ServerResponse } from 'node:http';

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => void | Promise<void>;

interface RegisteredRoute {
  segments: string[];
  paramIndexes: number[];
  handler: RouteHandler;
}

/**
 * 路径匹配（含 :param）。方法 + 精确段数匹配，
 * query string 由调用方剥离后传入。
 */
export class Router {
  private readonly routes = new Map<string, RegisteredRoute[]>();

  register(method: string, pattern: string, handler: RouteHandler): void {
    const segments = pattern.split('/').filter((s) => s.length > 0);
    const paramIndexes: number[] = [];
    for (let i = 0; i < segments.length; i += 1) {
      if (segments[i]!.startsWith(':')) {
        paramIndexes.push(i);
      }
    }
    const list = this.routes.get(method) ?? [];
    list.push({ segments, paramIndexes, handler });
    this.routes.set(method, list);
  }

  match(
    method: string,
    pathname: string,
  ): { handler: RouteHandler; params: Record<string, string> } | null {
    const candidates = this.routes.get(method);
    if (candidates === undefined) {
      return null;
    }
    const parts = pathname.split('/').filter((s) => s.length > 0);
    for (const route of candidates) {
      if (route.segments.length !== parts.length) {
        continue;
      }
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < parts.length; i += 1) {
        const pattern = route.segments[i]!;
        if (pattern.startsWith(':')) {
          params[pattern.slice(1)] = decodeURIComponent(parts[i]!);
        } else if (pattern !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}
