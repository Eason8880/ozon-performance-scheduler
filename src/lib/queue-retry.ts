import type { MessageMetadata, RetryDirective } from "@vercel/queue";

const backoffSeconds = [60, 300, 900, 3600, 3600];
export const maxQueueDeliveries = backoffSeconds.length + 1;

export function retryDirective(deliveryCount: number): RetryDirective {
  if (deliveryCount >= maxQueueDeliveries) return { acknowledge: true };
  const index = Math.max(0, deliveryCount - 1);
  return { afterSeconds: backoffSeconds[index] };
}

export function retryQueueMessage(error: unknown, metadata: MessageMetadata) {
  const directive = retryDirective(metadata.deliveryCount);
  if ("acknowledge" in directive && directive.acknowledge) {
    // Do not log provider response bodies or any credentials.
    console.error("Queue task exhausted retries", metadata.messageId);
  }
  if (error instanceof Error && error.message === "Invalid schedule payload") {
    return { acknowledge: true } as const;
  }
  return directive;
}
