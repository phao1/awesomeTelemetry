import { createServer, type Server, type ServerResponse } from 'node:http';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const HEALTH_PATH = '/api/health';

/** M0 尚无选项；M2 起会加入数据目录等配置。 */
export type AgentObservabilityServerOptions = Record<string, never>;

export interface HealthResponse {
  ok: true;
  schemaVersion: 1;
  uptimeMs: number;
  dbSizeBytes: number;
  walSizeBytes: number;
  devOnly: string[];
}

/** contracts/api.md §0.3 统一错误信封。 */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function createAgentObservabilityServer(
  _opts: AgentObservabilityServerOptions,
): Server {
  const startedAt = Date.now();

  return createServer((req, res) => {
    const method = req.method ?? 'GET';
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';

    if (method === 'GET' && pathname === HEALTH_PATH) {
      const body: HealthResponse = {
        ok: true,
        schemaVersion: 1,
        uptimeMs: Date.now() - startedAt,
        dbSizeBytes: 0,
        walSizeBytes: 0,
        devOnly: [],
      };
      sendJson(res, 200, body);
      return;
    }

    const errorBody: ApiError = {
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `No route registered for ${method} ${pathname}`,
      },
    };
    sendJson(res, 404, errorBody);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': JSON_CONTENT_TYPE,
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
