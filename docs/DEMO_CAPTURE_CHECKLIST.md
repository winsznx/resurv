# Demo capture checklist

Everything needed to record the video without stopping to look something up, and every fallback
for the two things that can fail on the day.

## Before you start recording

- [ ] `pnpm gate` exits 0
- [ ] `pnpm build && pnpm --filter @resurv/web preview` is serving on :4173, or the deployed
      Cloudflare URL loads. Prefer the production bundle over `dev`: it is what the screenshots
      in the README were taken from and what a judge will actually see
- [ ] the "Verify now" card on the page shows `SATISFIED` and `agree`, which means both public
      RPC origins are answering right now
- [ ] a terminal is open at the repository root with `cast --version` working
- [ ] browser zoom at 100%, window at 1440×900 or wider, light mode
- [ ] no wallet extension popups, no notification banners, no other tabs visible

## URLs, in the order the script uses them

| # | What | URL |
|---|---|---|
| 1 | Proof page, hero | the deployed Worker URL, or `http://localhost:4173` |
| 2 | Proof page, timeline | same page, `#timeline` |
| 3 | Trigger transaction | https://sepolia.basescan.org/tx/0x6a796dc3d3056d6d5a3a9de22bd0d5f506b91fb36c8ced640e74a340523afe66 |
| 4 | Proof page, refused primary | same page, timeline beat 07 — the only orange on the page |
| 5 | **The successful attempt** | https://sepolia.basescan.org/tx/0xef63ee114dea86da25f1d38802be8bfbdcce166a140f322d283f22a41f9c7e22 |
| 6 | Its logs tab | the same URL, `#eventlog` |
| 7 | Proof page, one transaction | same page, `#atomic` |
| 8 | Proof page, duplicate protection | same page, timeline beats 09 and 10 |
| 9 | Proof page, verify now | same page, `#verify` |
| 10 | Covenant manager | https://sepolia.basescan.org/address/0x8e4c71d6c99a10f442e70fd236c3d583d9d9d284 |

## If the public RPC origins are refusing

They do, under repeated load: `docs/assets/capture-report.json` records CORS and TLS failures
from back-to-back screenshot runs. The page shows `RPC down` rather than inventing a number,
which is correct and also not what you want on camera.

Wait a minute and reload. Everything the video actually claims comes from the committed receipt
and from Basescan, both of which are unaffected. The "Verify now" card is the only live surface,
and if it will not settle, run the `cast call` below on camera instead — it makes the same point
more directly.

## Terminal commands, exactly as typed

The status read, which is the one to run live:

```bash
cast call 0x8e4c71d6c99a10f442e70fd236c3d583d9d9d284 \
  "statusOf(bytes32)(uint8)" \
  0xa5e71176ccfc47947d0a292bdd63fd0b8ccc64a2b62f1cfc9f1cbdb6787c9cf0 \
  --rpc-url https://sepolia.base.org
```

Expected output: `5`

The receipt, if there is time:

```bash
cast receipt 0xef63ee114dea86da25f1d38802be8bfbdcce166a140f322d283f22a41f9c7e22 \
  --rpc-url https://sepolia.base.org
```

Expected: `status 1 (success)`, six logs.

The verifier, live, which is the strongest single read:

```bash
cast call 0x8e4c71d6c99a10f442e70fd236c3d583d9d9d284 \
  "readOutcome(bytes32,bytes)(bool,bytes32,uint256)" \
  0xa5e71176ccfc47947d0a292bdd63fd0b8ccc64a2b62f1cfc9f1cbdb6787c9cf0 \
  0x$(cat docs/proof/canonical-covenant.json | grep -o '"verifierContext": "0x[^"]*"' | head -1 | sed 's/.*0x//;s/"//') \
  --rpc-url https://sepolia.base.org
```

Expected: `true`, a state hash, `1000000`.

## The values on screen, so nothing has to be read off a terminal

| | |
|---|---|
| Covenant | `0xa5e71176ccfc47947d0a292bdd63fd0b8ccc64a2b62f1cfc9f1cbdb6787c9cf0` |
| Success transaction | `0xef63ee114dea86da25f1d38802be8bfbdcce166a140f322d283f22a41f9c7e22` |
| Block | 45421180 |
| Manager | `0x8e4c71d6c99a10f442e70fd236c3d583d9d9d284` |
| Demo vault | `0x291efc6f53559d8316761309e856772f10d0cdc4` |
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
