# Demo script

Target 2:45. Legible with the sound off: every claim is on screen as text or as a transaction,
and the narration only says what the screen already shows.

Everything below is a real artifact. Nothing is re-enacted, and no hash on screen was invented.

---

## 0:00 – 0:20 · The promise

**On screen:** the proof page hero.

> The transaction landed. That was never the question.

**Say:**

> Most onchain automation stops when a transaction confirms. A protocol operator doesn't need a
> transaction. They need a state. RESURV is a covenant over that state.

**Cut to** the covenant card, which is already on the page:

```text
SAFE MEANS      the vault is paused
                OR the vault is empty and the approved recipient received 1.000000 rUSD
PLAN            0  pause          1  evacuate-to-safe
SUCCESS FEE     1.000000 rUSD, escrowed
```

---

## 0:20 – 0:45 · The trigger

**On screen:** the timeline, beats 01 through 06, scrolling to `A signed risk trigger is accepted`.
The phase labels down the left — before the incident, the covenant, the incident — carry the
structure without narration, which is what makes this legible with the sound off.

**Say:**

> A signed risk signal arrives. The covenant moves to TRIGGERED and consumes its nonce. Nothing
> has executed yet, and the fee is locked.

**Point at:** the trigger transaction link. Open it if there is time.

---

## 0:45 – 1:15 · The primary action cannot proceed

**On screen:** timeline beat 07, with the orange marker and the `refused, not broadcast` chip.
It is the loudest thing on the rail and the only orange on the page, which is deliberate.

**Say:**

> The first approved action is `pause`. Before anything is broadcast, KeeperHub simulates it. It
> would revert: the adapter's role on the vault was revoked. The exact reason is on screen.

**Point at the note, verbatim on the page:**

```text
HTTP 400; AccessControlUnauthorizedAccount(0x345FdCFE…, 0xaf922051…)
```

**Say, and this is the sentence the whole demo exists for:**

> No transaction was sent. Nothing on chain moved. RESURV did not retry it, did not widen its
> authority, and did not guess. It moved to the next action the covenant had already approved,
> and only to that one.

---

## 1:15 – 1:55 · The fallback executes

**On screen:** timeline beat 08, `confirmed on chain`, then click through to Basescan.

**Say:**

> The second action simulates clean and executes through KeeperHub. The organization wallet is
> the sender; the gas is sponsored; the wallet holds no ETH at all.

**On screen:** the Basescan logs tab of
`0xf7f9aace84a73bc236b2b44468026137fa5a52a96511a28f2951001a729d86ab`.

---

## 1:55 – 2:20 · One transaction

**On screen:** the "One transaction, six logs, in this order" card, then the same six on Basescan.

**Say, reading the list:**

> Attempt started. The vault transfers to the approved recipient. The vault records the
> evacuation. The attempt reports what it did. The escrow releases the fee to the responder. The
> covenant becomes satisfied.
>
> One transaction. Had the verifier returned false, none of these six logs would exist. That is
> not rollback — RESURV can't undo a confirmed transaction and never says it can. It makes sure
> the one it sends either produces the promised state or produces nothing.

---

## 2:20 – 2:35 · Duplicate protection

**On screen:** timeline beats 09 and 10, both `rejected`.

**Say:**

> The same signed trigger, replayed: rejected. The same attempt, replayed: rejected. Two
> independent grounds — the covenant is terminal, and the attempt id was burned on chain
> permanently. KeeperHub's idempotency bounds effects per key for 24 hours; this is what makes it
> permanent.

---

## 2:35 – 2:45 · Check it yourself

**On screen:** the "Verify now" card reading live from two RPC origins, then the terminal block.

**Say:**

> This page reads chain from your browser, from two independent nodes, with no RESURV server in
> the path. Or run it yourself.

**Type, live:**

```bash
cast call 0xfcafbc81f253e62a3818ecda7a7a71e557c65b21 \
  "statusOf(bytes32)(uint8)" \
  0xd7250d1fd4c0f996475b78a00489ce0668bad187b342ca61d88983bf0ec7e14f \
  --rpc-url https://sepolia.base.org
```

**Result on screen:** `5`, which is `SATISFIED`.

**Close:**

> The transaction landed. RESURV proves the outcome was reached, and pays only then.

---

## If there are thirty seconds spare

The one detail worth adding, because it is the least expected thing in the build:

> Every contract here was deployed by a sponsored KeeperHub contract call to a public CREATE2
> factory. The organization wallet has no native currency and there is no deployment endpoint, so
> RESURV deployed itself with no funded deployer and no faucet. Six contracts, six addresses
> computed before sending, six matches.

## If someone asks about security

Answer it directly. The answer is a strength in this build and hedging makes it a weakness.

> No external audit. Four in-repo reviewers ran against the finished build and three returned
> FAIL. Two rounds of that found five distinct ways a covenant's escrow could be trapped
> permanently, each with a working proof-of-concept. They are fixed and every fix is pinned by a
> regression test that was checked by reverting the fix. Two more findings are accepted rather
> than fixed and named in the repository.

And the sentence to volunteer rather than wait to be caught on:

> The deployed bytecode predates the last round, so three of those fixes are in the repository and
> not on chain. Redeploying invalidates the canonical receipt, so it was not done. None of the
> three affects this covenant, which uses the honest shipped verifier and was never paused.

## What not to say

None of these are supported and all of them are easy to say by accident:

- "trustless" — the organization wallet and the RESURV admin are trusted
- "rolls back" — nothing undoes a confirmed transaction
- "MEV protected" or "private mempool" — measured off on Base Sepolia
- "exactly once" — bounded per idempotency key for 24 hours; permanence is the onchain attempt id
- "production ready" — testnet, no external audit
- "guaranteed recovery" — a protocol can revoke every useful role, and then nothing works
