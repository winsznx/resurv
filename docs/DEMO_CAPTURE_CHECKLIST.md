# Demo capture checklist

Everything needed to record the video without stopping to look something up, and every fallback
for the two things that can fail on the day.

## Before you start recording

- [ ] `pnpm gate` exits 0
- [ ] `pnpm --filter @resurv/web dev` is serving, or the deployed Cloudflare URL loads
- [ ] the "Verify now" card on the page shows `SATISFIED` and `agree`, which means both public
      RPC origins are answering right now
- [ ] a terminal is open at the repository root with `cast --version` working
- [ ] browser zoom at 100%, window at 1440×900 or wider, light mode
- [ ] no wallet extension popups, no notification banners, no other tabs visible

## URLs, in the order the script uses them

| # | What | URL |
|---|---|---|
| 1 | Proof page, hero | the deployed Worker URL, or `http://localhost:5173` |
| 2 | Proof page, timeline | same page, `#timeline` |
| 3 | Trigger transaction | https://sepolia.basescan.org/tx/0x3fd2777b1b154010ce30a166e38d8c90e339dde98965d56cfe66f435bceb145f |
| 4 | Proof page, refused primary | same page, timeline step 7 |
| 5 | **The successful attempt** | https://sepolia.basescan.org/tx/0x9ea030674ca2e9ee8729bf00a6fbf53cd48320c23d0ae0a0b9780bb0da59dbcb |
| 6 | Its logs tab | the same URL, `#eventlog` |
| 7 | Proof page, one transaction | same page, `#atomic` |
| 8 | Proof page, duplicate protection | same page, timeline steps 9 and 10 |
| 9 | Proof page, verify now | same page, `#verify` |
| 10 | Covenant manager | https://sepolia.basescan.org/address/0x01cd0adb80df64d223e6e95789d29f144e87a037 |

## Terminal commands, exactly as typed

The status read, which is the one to run live:

```bash
cast call 0x01cd0adb80df64d223e6e95789d29f144e87a037 \
  "statusOf(bytes32)(uint8)" \
  0xb8c1c6ecb47cd4ed69755ca28e651348e72d58700ecf63da6e2c25896265694d \
  --rpc-url https://sepolia.base.org
```

Expected output: `5`

The receipt, if there is time:

```bash
cast receipt 0x9ea030674ca2e9ee8729bf00a6fbf53cd48320c23d0ae0a0b9780bb0da59dbcb \
  --rpc-url https://sepolia.base.org
```

Expected: `status 1 (success)`, six logs.

The verifier, live, which is the strongest single read:

```bash
cast call 0x01cd0adb80df64d223e6e95789d29f144e87a037 \
  "readOutcome(bytes32,bytes)(bool,bytes32,uint256)" \
  0xb8c1c6ecb47cd4ed69755ca28e651348e72d58700ecf63da6e2c25896265694d \
  0x$(cat docs/proof/canonical-covenant.json | grep -o '"verifierContext": "0x[^"]*"' | head -1 | sed 's/.*0x//;s/"//') \
  --rpc-url https://sepolia.base.org
```

Expected: `true`, a state hash, `1000000`.

## The values on screen, so nothing has to be read off a terminal

| | |
|---|---|
| Covenant | `0xb8c1c6ecb47cd4ed69755ca28e651348e72d58700ecf63da6e2c25896265694d` |
| Success transaction | `0x9ea030674ca2e9ee8729bf00a6fbf53cd48320c23d0ae0a0b9780bb0da59dbcb` |
| Block | 45397010 |
| Manager | `0x01cd0adb80df64d223e6e95789d29f144e87a037` |
| Demo vault | `0x721a99416f2c32a139e1a96a647e8d4e006db335` |
| Approved recipient | `0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe` |
| Responder | `0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0` |
| Organization wallet | `0xfd35ae935de7be93ffd585d6627268d833ed834c` |
| Fee | 1.000000 rUSD |

## Fallbacks

**If a public RPC endpoint is down** and the "Verify now" card shows an error: the card says so
explicitly and the committed evidence on the rest of the page is unaffected. Say so on camera —
"one of the two public nodes isn't answering right now, which is exactly why the covenant
requires two" — and use Basescan for the reads. It is a better moment than pretending it did not
happen.

**If Basescan is slow**, use the JSON surface instead:

```bash
curl -s <worker-url>/api/proof/summary | jq
```

Eight booleans, every one reproducible with `cast`.

**If you want to re-run the whole thing live**, it takes about ninety seconds and creates a *new*
covenant, leaving the recorded one untouched:

```bash
pnpm --filter @resurv/cli live:demo
```

Do not do this during the recording unless there is time to spare: it needs the organization
credential and it lands about eight real transactions.

## After recording

- [ ] the video shows at least one full transaction hash, readable, on screen
- [ ] the video shows the refused primary action and the successful fallback as two distinct
      states, not one summary
- [ ] the video never says any of the forbidden phrases in `docs/DEMO_SCRIPT.md`
- [ ] the submission carries all three required assets: the repository link, the video, and the
      link to the real KeeperHub transaction
