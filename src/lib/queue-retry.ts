import type { MessageMetadata, RetryDirective } from "@vercel/queue";

const backoffSeconds = [60, 300, 900];
/** Interval between attempts once the initial backoff is used up. */
export const steadyRetrySeconds = 900;

/**
 * Failed edges keep retrying instead of being dropped after a few attempts.
 *
 * Each delivery re-reads the store and applies the state its schedule wants
 * at that moment, so a late retry is always correct and never replays a stale
 * action. A message stops retrying when the state is already applied (by this
 * message or a later edge), the store is paused, deleted or reconfigured, or
 * the queue's retention (24 hours by default) expires it. Without this, an
 * outage longer than the old ~2.5 hour retry budget left a promotion on or off
 * until the next day's edge.
 */
export function retryDirective(deliveryCount: number): RetryDirective {
  const index = Math.max(0, deliveryCount - 1);
  return { afterSeconds: backoffSeconds[index] ?? steadyRetrySeconds };
}

export function retryQueueMessage(error: unknown, metadata: MessageMetadata) {
  if (error instanceof Error && error.message === "Invalid schedule payload") {
    return { acknowledge: true } as const;
  }
  // Do not log provider response bodies or any credentials.
  console.error(
    "Queue task failed; retrying",
    metadata.messageId,
    `delivery ${metadata.deliveryCount}`,
    error instanceof Error ? error.message : "unknown error",
  );
  return retryDirective(metadata.deliveryCount);
}
