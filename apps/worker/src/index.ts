import { BASE_SEPOLIA, explorerTxUrl } from '@resurv/chain';
import {
  ConfigError,
  knownSecretValues,
  parseWorkerEnv,
  redactedJson,
  redactString,
} from '@resurv/config';
import { DEPLOYMENT, decodeVerifierContext, RECEIPT } from '@resurv/proof';
import { Hono } from 'hono';

/**
 * RESURV Worker. One deployable with three entry points:
 *   - `fetch`     read APIs, the public proof surface, and health.
 *   - `scheduled` reconciliation sweep. Reserved.
 *   - `queue`     attempt execution. Reserved.
 *
 * Only `fetch` exists, and that is a deliberate architectural line rather than an unfinished
 * one: PRD 14.4 forbids a long-running execution loop in the request path, and the orchestrator
 * that runs covenants is `@resurv/orchestrator`, driven by the CLI. Nothing served here holds a
 * KeeperHub credential, and nothing served here can execute anything.
 */

type Bindings = Record<string, unknown>;

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Liveness. Reports configuration validity without ever echoing a secret: the response says
 * whether the environment parsed, and names the failing variables, never their values.
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

/**
 * The proof surface, served as data.
 *
 * It is the same committed artifacts the page renders, so a judge who prefers JSON to a browser
 * gets the same bytes rather than a summary of them. No credential is read to produce this
 * response, and none could be: the Worker imports the receipt at build time and holds nothing
 * else.
 */
app.get('/api/proof', (c) =>
  c.json({
    covenant: RECEIPT.covenant,
    recoveryPlan: RECEIPT.recoveryPlan,
    trigger: RECEIPT.trigger,
    steps: RECEIPT.steps,
    outcome: RECEIPT.outcome,
    successTransaction: {
      ...RECEIPT.successTransaction,
      link:
        RECEIPT.successTransaction.hash === undefined
          ? undefined
          : explorerTxUrl(RECEIPT.successTransaction.hash),
    },
    limitations: RECEIPT.limitations,
    generatedAt: RECEIPT.generatedAt,
    chain: RECEIPT.chain,
  }),
);

/** The deployment manifest, including bytecode hashes and the compiler settings. */
app.get('/api/deployment', (c) => c.json(DEPLOYMENT));

/**
 * A machine-checkable summary. Every field is a fact somebody can reproduce with `cast`, and
 * `checks` is what an independent verifier is expected to disagree with if RESURV is wrong.
 */
app.get('/api/proof/summary', (c) =>
  c.json({
    chainId: RECEIPT.chain.chainId,
    covenantId: RECEIPT.covenant.covenantId,
    manager: RECEIPT.covenant.manager,
    successTransaction: RECEIPT.successTransaction.hash,
    checks: {
      terminalStatusIsSatisfied: RECEIPT.outcome.terminalStatus === 5,
      verifierReturnedTrue: RECEIPT.outcome.satisfied,
      vaultEmptied: RECEIPT.outcome.vaultBalance === '0',
      // Against the minimum the covenant actually declared, decoded from the committed verifier
      // context. An earlier version asserted only that the balance was non-zero, which is a
      // weaker statement than the covenant made and would have passed on a dust delivery.
      recipientReceivedTheMinimum:
        BigInt(RECEIPT.outcome.safeBalance) >=
        decodeVerifierContext().safeBaseline + decodeVerifierContext().minimumReceived,
      responderPaid: RECEIPT.outcome.responderBalance !== '0',
      primaryActionRefusedBeforeBroadcast:
        RECEIPT.steps.find((step) => step.label === 'attempt-primary')?.state ===
        'SIMULATION_REJECTED',
      duplicateTriggerRejected:
        RECEIPT.steps.find((step) => step.label === 'replay-trigger')?.state === 'REJECTED',
      duplicateAttemptRejected:
        RECEIPT.steps.find((step) => step.label === 'replay-attempt')?.state === 'REJECTED',
      everyDeployedAddressWasPredicted: Object.values(DEPLOYMENT.contracts).every(
        (contract) => contract.predictedAddressMatched,
      ),
    },
  }),
);

app.notFound((c) => c.json({ error: 'not_found', detail: `no route for ${c.req.path}` }, 404));

/**
 * The one place an arbitrary throw becomes a log line. Everything about the error goes through
 * redaction: an upstream client is free to put a key in a message and this is the last point
 * where that can be stopped.
 */
app.onError((error, c) => {
  console.error('unhandled', redactedJson(error, { knownSecrets: knownSecretValues(c.env) }));
  return c.json({ error: 'internal_error' }, 500);
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Bindings>;
