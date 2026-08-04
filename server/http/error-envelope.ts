import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendJson } from './send-json.js';

/** contracts/api.md §0.4 错误码全集。 */
export const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_ENUM: 'INVALID_ENUM',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  PROXY_REQUEST_NOT_FOUND: 'PROXY_REQUEST_NOT_FOUND',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  PROVIDER_DISABLED: 'PROVIDER_DISABLED',
  SESSION_PARSE_FAILED: 'SESSION_PARSE_FAILED',
  PROXY_ALREADY_RUNNING: 'PROXY_ALREADY_RUNNING',
  PROXY_NOT_RUNNING: 'PROXY_NOT_RUNNING',
  FRIDA_TARGET_NOT_FOUND: 'FRIDA_TARGET_NOT_FOUND',
  TRAE_KEY_MISSING: 'TRAE_KEY_MISSING',
  SCAN_IN_PROGRESS: 'SCAN_IN_PROGRESS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DECRYPT_FAILED: 'DECRYPT_FAILED',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** contracts/api.md §0.3：所有非 2xx 响应的统一信封。 */
export function apiError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiErrorBody {
  return {
    error: details === undefined ? { code, message } : { code, message, details },
  };
}

export function sendApiError(
  res: ServerResponse,
  status: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  req?: IncomingMessage,
): void {
  sendJson(res, status, apiError(code, message, details), req);
}
