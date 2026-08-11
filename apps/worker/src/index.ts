import { BASE_SEPOLIA } from '@resurv/chain';
import {
  ConfigError,
  knownSecretValues,
  parseWorkerEnv,
  redactedJson,
  redactString,
} from '@resurv/config';
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
 *
 * Zod's messages name a variable and not its value, so this is belt and braces. It is here
 * because a validation message is exactly the kind of string that starts quoting its input
 * one library upgrade later.
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
      const knownSecrets = knownSecretValues(c.env);
      return c.json(
        {
          status: 'misconfigured',
          configured: false,
          issues: error.issues.map((issue) => redactString(issue, { knownSecrets })),
        },
        503,
      );
    }
    throw error;
  }
});

app.notFound((c) => c.json({ error: 'not_found', detail: `no route for ${c.req.path}` }, 404));

/**
 * The one place an arbitrary throw becomes a log line. Everything about the error goes
 * through redaction: an upstream client is free to put a key in a message and this is the
 * last point where that can be stopped.
 */
app.onError((error, c) => {
  console.error('unhandled', redactedJson(error, { knownSecrets: knownSecretValues(c.env) }));
  return c.json({ error: 'internal_error' }, 500);
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Bindings>;
