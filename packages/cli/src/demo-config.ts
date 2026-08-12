/**
 * The canonical demo's fixed cast.
 *
 * Two of these addresses are deliberately legible rather than random, because a judge reading a
 * transaction should be able to tell the approved recipient from the responder without a
 * legend. Neither is controlled by anyone: they are destinations in a demo whose only asset is
 * a test token with an open mint, and nothing of value can be stranded in them.
 *
 * The requester is the KeeperHub organization wallet, which is also the executor. In production
 * those are different parties: the requester is a protocol's operations multisig and the
 * executor is whichever responder holds `EXECUTOR_ROLE`. Saying so here rather than implying
 * otherwise in the demo is the point of this comment.
 */

export const APPROVED_SAFE = '0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe' as const;
export const RESPONDER = '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0' as const;

/** One test dollar, six decimals. The vault holds this and the covenant escrows the same. */
export const ONE_TEST_DOLLAR = 1_000_000n;

/** How long the covenant stays live. Long enough to inspect, short enough to expire. */
export const COVENANT_DURATION_SECONDS = 7 * 24 * 60 * 60;

/** How long a signed trigger stays valid once issued. */
export const SIGNAL_WINDOW_SECONDS = 60 * 60;

export const ACTION_PAUSE = 0;
export const ACTION_EVACUATE = 1;
