export const KEEPERHUB_API_ORIGIN = 'https://app.keeperhub.com';

export const KEEPERHUB_ENDPOINTS = {
  chains: '/api/chains',
  keys: '/api/keys',
  user: '/api/user',
  executeTransfer: '/api/execute/transfer',
  executeContractCall: '/api/execute/contract-call',
  executeCheckAndExecute: '/api/execute/check-and-execute',
  executionStatus: (executionId: string) => `/api/execute/${executionId}/status`,
} as const;

/**
 * Organization API keys carry this prefix. A `wfb_` key is a user key for webhook triggers
 * and will not authenticate the execution endpoints, so we diagnose that mistake by name
 * instead of surfacing a bare 401.
 */
export const ORG_API_KEY_PREFIX = 'kh_';
export const WEBHOOK_KEY_PREFIX = 'wfb_';

/** Documented rate limit: 60 requests per minute per key. */
export const RATE_LIMIT_PER_MINUTE = 60;

export const RATE_LIMIT_HEADERS = {
  limit: 'X-RateLimit-Limit',
  remaining: 'X-RateLimit-Remaining',
  reset: 'X-RateLimit-Reset',
  retryAfter: 'Retry-After',
  pollIntervalHint: 'X-Poll-Interval-Hint',
} as const;

/**
 * Transport idempotency window. RESURV's economic idempotency is permanent and enforced
 * onchain; this constant governs only what KeeperHub will replay for us.
 */
export const IDEMPOTENCY_REPLAY_WINDOW_SECONDS = 24 * 60 * 60;

/** Scopes required to broadcast. `simulate: true` only needs `mcp:read`. */
export const SCOPE_SIMULATE = 'mcp:read';
export const SCOPE_BROADCAST = 'mcp:write';
