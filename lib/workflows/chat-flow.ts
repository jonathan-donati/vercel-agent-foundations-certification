import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { getWritable } from "workflow";
import { convertToModelMessages, type UIMessage } from "ai";
import { searchProducts, getAllCategories, getProductDetails, returnOrder } from "@/lib/tools";

export async function chatFlow(messages: UIMessage[]) {
  "use workflow";

  const modelMessages = await convertToModelMessages(messages);

  // Same model, instructions and tools as the ToolLoopAgent in lib/agent.ts,
  // but the whole loop runs inside a durable workflow.
  const agent = new WorkflowAgent({
    model: "anthropic/claude-sonnet-5",
    instructions: [
      "Keep responses informative but concise. Highlight any promos or deals first when answering questions. Include shipping/tax charges up front.",
      "Choosing a product tool:",
      "- searchProducts is for BROAD lookups: browsing, recommendations, comparing several items, or finding the id of an item the user named.",
      "- getProductDetails is for ONE SPECIFIC item. Whenever the user asks about a particular product (e.g. 'Tell me more about the black hoodie', 'Is the mug in stock?', 'What sizes does the tee come in?'), call getProductDetails. Never answer those questions from searchProducts results alone.",
      "- If you only know the item's name, call searchProducts to find its id or slug, then call getProductDetails with it.",
      "When asked about a type or category of product, use getAllCategories to get valid categories before using searchProducts.",
      "Product results are shown to the user as product cards. Do not repeat image URLs, prices, or stock counts in your text; add a short comment instead (what it's good for, low-stock warnings, size advice, related items worth a look).",
      "When the user wants to return an order, use the returnOrder tool. Ask for the order ID and reason if they haven't provided them. Example order IDs are 11111, 22222, and 33333.",
    ].join("\n"),
    tools: { searchProducts, getAllCategories, getProductDetails, returnOrder },
  });

  await agent.stream({
    messages: modelMessages,
    writable: getWritable<ModelCallStreamPart>(),
  });
}
