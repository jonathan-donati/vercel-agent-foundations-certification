"use client";

/**
 * WorkflowChatTransport, plus framing repair for tool-call chunks.
 *
 * Each durable model call writes a `reset-step` chunk before it streams.
 * On `reset-step` the AI SDK's stream consumer forgets every tool call that is
 * still streaming its input. If a model-call step runs more than once with
 * overlapping output (a retry or a queue redelivery), the second attempt's
 * `reset-step` can land in the middle of the first attempt's tool call. The
 * first attempt's remaining `tool-input-delta` chunks then reference a tool
 * call the client has just dropped, and useChat throws:
 *
 *   Received tool-input-delta for missing tool call with ID "toolu_…"
 *
 * WorkflowChatTransport already repairs this for text and reasoning parts but
 * deliberately leaves tool parts alone. This transport drops the leftover
 * chunks of tool calls that were superseded by a `reset-step`, so only the
 * attempt that is actually running is rendered.
 */

import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import type { UIMessage, UIMessageChunk } from "ai";

function createToolChunkRepair(): TransformStream<UIMessageChunk, UIMessageChunk> {
  // Tool calls whose input started streaming since the last reset-step.
  let open = new Set<string>();
  // Tool calls that were still open when a reset-step arrived.
  const superseded = new Set<string>();

  return new TransformStream({
    transform(chunk, controller) {
      switch (chunk.type) {
        case "reset-step":
          for (const id of open) superseded.add(id);
          open = new Set();
          break;
        case "tool-input-start":
          superseded.delete(chunk.toolCallId);
          open.add(chunk.toolCallId);
          break;
        case "tool-input-delta":
        case "tool-input-available":
        case "tool-input-error":
          if (superseded.has(chunk.toolCallId)) return; // drop leftover chunk
          if (chunk.type !== "tool-input-delta") open.delete(chunk.toolCallId);
          break;
        case "tool-output-available":
        case "tool-output-error":
          if (superseded.has(chunk.toolCallId)) return;
          break;
      }
      controller.enqueue(chunk);
    },
  });
}

export class DurableChatTransport<
  UI_MESSAGE extends UIMessage,
> extends WorkflowChatTransport<UI_MESSAGE> {
  override async sendMessages(
    ...args: Parameters<WorkflowChatTransport<UI_MESSAGE>["sendMessages"]>
  ) {
    const stream = await super.sendMessages(...args);
    return stream.pipeThrough(createToolChunkRepair());
  }

  override async reconnectToStream(
    ...args: Parameters<WorkflowChatTransport<UI_MESSAGE>["reconnectToStream"]>
  ) {
    const stream = await super.reconnectToStream(...args);
    return stream ? stream.pipeThrough(createToolChunkRepair()) : stream;
  }
}
