/**
 * Scripted doubles for the two external systems.
 *
 * Both are driven at the `fetch` boundary rather than by stubbing our own modules, so the
 * transport, the error normalization, the quorum comparison and the classifier all really run.
 * A test that stubbed `getReceipt` would prove the executor calls a function; this proves it
 * reads a receipt.
 */

export interface ScriptedResponse {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  /** When set, the request rejects instead of answering. A lost response, not a 5xx. */
  readonly throws?: string;
}

export class FakeKeeperhub {
  readonly requests: { path: string; idempotencyKey: string | null; body: string | null }[] = [];
  #script: ScriptedResponse[] = [];
  #statusResponses: ScriptedResponse[] = [];

  /** Responses to `POST /api/execute/contract-call`, in order. The last one repeats. */
  onExecute(...responses: ScriptedResponse[]): this {
    this.#script = responses;
    return this;
  }

  /** Responses to `GET /api/execute/{id}/status`, in order. The last one repeats. */
  onStatus(...responses: ScriptedResponse[]): this {
    this.#statusResponses = responses;
    return this;
  }

  get executeCount(): number {
    return this.requests.filter((request) => request.path.endsWith('contract-call')).length;
  }

  get distinctIdempotencyKeys(): string[] {
    return [
      ...new Set(
        this.requests
          .map((request) => request.idempotencyKey)
          .filter((key): key is string => key !== null),
      ),
    ];
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input);
    const headers = new Headers(init?.headers);
    this.requests.push({
      path: url,
      idempotencyKey: headers.get('Idempotency-Key'),
      body: typeof init?.body === 'string' ? init.body : null,
    });

    const queue = url.includes('/status') ? this.#statusResponses : this.#script;
    const index = Math.min(
      queue.length - 1,
      this.requests.filter((request) =>
        url.includes('/status')
          ? request.path.includes('/status')
          : !request.path.includes('/status'),
      ).length - 1,
    );
    const scripted = queue[Math.max(0, index)] ?? { status: 200, body: {} };
    if (scripted.throws !== undefined) {
      throw new Error(scripted.throws);
    }
    return new Response(JSON.stringify(scripted.body ?? {}), {
      status: scripted.status ?? 200,
      headers: { 'content-type': 'application/json', ...(scripted.headers ?? {}) },
    });
  };
}

export interface FakeChainState {
  receipt?: unknown;
  /** A second origin's answer. When set, the two origins are asked to disagree. */
  receiptFromSecondOrigin?: unknown;
  logs?: unknown[];
  blockNumber?: string;
}

export class FakeRpc {
  readonly calls: string[] = [];
  /** Every `eth_getLogs` filter, so a test can assert which block the search actually started at. */
  readonly logQueries: { fromBlock: string; toBlock: string }[] = [];

  constructor(readonly state: FakeChainState) {}

  readonly origins = ['https://origin-a.test', 'https://origin-b.test'];

  readonly fetch: typeof fetch = async (input, init) => {
    const origin = typeof input === 'string' ? input : String(input);
    const request = JSON.parse(String(init?.body ?? '{}')) as {
      method: string;
      params?: unknown[];
    };
    this.calls.push(`${origin} ${request.method}`);
    if (request.method === 'eth_getLogs') {
      const filter = request.params?.[0] as { fromBlock: string; toBlock: string };
      this.logQueries.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock });
    }

    const answer = (result: unknown): Response =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    switch (request.method) {
      case 'eth_blockNumber':
        return answer(this.state.blockNumber ?? '0x10');
      case 'eth_getLogs':
        return answer(this.state.logs ?? []);
      case 'eth_getTransactionReceipt': {
        const second = this.state.receiptFromSecondOrigin;
        if (second !== undefined && origin === this.origins[1]) return answer(second);
        return answer(this.state.receipt ?? null);
      }
      default:
        return answer(null);
    }
  };
}

export const EXPECTED_TOPIC = '0xb1250b34512bd0d2b55eb929e1a23d4a2dbc2b7fa8ab637784a669ab30ae09a4';
export const TARGET = '0x00000000000000000000000000000000000000aa';

export function receiptWithExpectedEvent(status: '0x1' | '0x0' = '0x1'): unknown {
  return {
    transactionHash: '0xabc',
    status,
    blockNumber: '0x11',
    blockHash: '0xbbb',
    from: '0xrelayer',
    to: '0xrouter',
    gasUsed: '0x1234',
    logs: [
      {
        address: TARGET,
        topics: [EXPECTED_TOPIC, '0xcov'],
        data: '0x',
        blockNumber: '0x11',
        transactionHash: '0xabc',
        logIndex: '0x0',
      },
    ],
  };
}

export function receiptWithoutExpectedEvent(): unknown {
  return {
    transactionHash: '0xabc',
    status: '0x1',
    blockNumber: '0x11',
    blockHash: '0xbbb',
    from: '0xrelayer',
    to: '0xrouter',
    gasUsed: '0x1234',
    logs: [
      {
        address: TARGET,
        topics: ['0xsomethingelse00000000000000000000000000000000000000000000000000'],
        data: '0x',
        blockNumber: '0x11',
        transactionHash: '0xabc',
        logIndex: '0x0',
      },
    ],
  };
}
