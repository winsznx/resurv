import { BASE_SEPOLIA } from '@resurv/chain';
import { ConfigError, parseWorkerEnv } from '@resurv/config';
import { Hono } from 'hono';

/**
 * RESURV Worker. One deployable with three entry points:
 *   - `fetch`     read APIs and health. No long-running execution loop lives here (PRD 14.4).
 *   - `scheduled` reconciliation sweep. Added in the orchestrator phase.
 *   - `queue`     attempt execution. Added in the orchestrator phase.
 *
 * Only `fetch` exists today. The other two are named here so the boundary is explicit
 * rather than discovered later, but no handler is registered until it does real work.
 */

type Bindings = Record<string, unknown>;

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Liveness. Reports configuration validity without ever echoing a secret: the response
 * says whether the environment parsed, and names the failing variables, never their values.
 */
app.get('/api/health', (c) => {
  try {
    const env = parseWorkerEnv(c.env);
    return c.json({
      status: 'ok',
      environment: env.ENVIRONMENT,
      chainId: env.CHAIN_ID,
      chainName: BASE_SEPOLIA.name,
      configured: true,
    });
  } catch (error) {
    if (error instanceof ConfigError) {
      return c.json({ status: 'misconfigured', configured: false, issues: error.issues }, 503);
    }
    throw error;
  }
});

app.notFound((c) => c.json({ error: 'not_found', detail: `no route for ${c.req.path}` }, 404));

app.onError((error, c) => {
  console.error('unhandled', { name: error.name, message: error.message });
  return c.json({ error: 'internal_error' }, 500);
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Bindings>;
