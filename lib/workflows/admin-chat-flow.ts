import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { getWritable } from "workflow";
import { convertToModelMessages, type UIMessage } from "ai";
import {
  bash,
  getReturnsHistory,
  getInventoryStock,
  getSalesAnalytics,
  getSupportTickets,
  searchProducts,
  getAllCategories,
} from "@/lib/tools";
import { createOrGetSandbox, ensureWorkdir, SANDBOX_NAME, SANDBOX_WORKDIR } from "@/lib/sandbox";

export const MEMORIES_PATH = `${SANDBOX_WORKDIR}/memories.md`;

// Reads the agent's memory file from the same sandbox the bash tool uses.
// "use step" makes this a durable, retried step: sandbox calls need full
// Node.js, which the workflow function itself doesn't have.
export async function readMemories(): Promise<string | null> {
  "use step";
  try {
    const sandbox = await createOrGetSandbox(SANDBOX_NAME);
    await ensureWorkdir(sandbox);
    const buffer = await sandbox.readFileToBuffer({ path: MEMORIES_PATH });
    return buffer ? new TextDecoder().decode(buffer) : null;
  } catch (err) {
    // Memory is a nice-to-have: if the sandbox is unavailable, answer without it.
    console.error("[readMemories] could not read memories.md:", err);
    return null;
  }
}

export const backOfficeInstructions = `You are the back-office assistant for the Vercel swag store. You have read-only access to returns, inventory, sales, and support tickets through tools, and a persistent bash sandbox for computation.

## Tools
- Returns: getReturnsHistory
- Inventory: getInventoryStock
- Sales: getSalesAnalytics
- Support: getSupportTickets
- Catalog search: searchProducts, getAllCategories
- Catalog search: searchProducts, getAllCategories
- Computation: bash (persistent sandbox)

## How to answer
- All prices, refund amounts, and revenues are in cents. Convert to dollars in user-facing answers (e.g. 2800 -> $28.00).
- Be concrete: name specific products, give specific numbers, and state the date range you used.
- If the user gives a vague time window ("this month", "recently"), pick a sensible range, state it explicitly, and proceed.
- For multi-step inference (return rates, day-over-day trends, spike detection, joins between sales and returns), prefer the bash tool: write fetched JSON to /tmp with a heredoc, then run python3 (stdlib only, no pandas) to compute. Don't eyeball aggregates over more than ~10 rows.
- Keep answers short and scannable. Lead with the headline number or finding, then a brief breakdown.
- Never promise to change anything in the store, you have read-only tools.`;

export async function adminChatFlow(messages: UIMessage[]) {
  "use workflow";

  const modelMessages = await convertToModelMessages(messages);

  // The model doesn't know today's date, which it needs for questions like
  // "yesterday's top sellers". (Inside a workflow, Date is fixed per run so
  // replays stay deterministic.)
  const today = new Date().toISOString().slice(0, 10);

  // Read memory once per run and fold it into the system prompt.
  const memories = await readMemories();

  const agent = new WorkflowAgent({
    model: "anthropic/claude-sonnet-5",
    instructions: [
      backOfficeInstructions,
      `Today's date is ${today}.`,
      "",
      "## Memory protocol",
      `You have a memories.md file at ${MEMORIES_PATH}. Append to it with the bash tool. Your bash commands run in ${SANDBOX_WORKDIR}, so relative paths like memories.md and scripts/ resolve there.`,
      "",
      memories ? `## Current memories\n\n${memories}` : "No memories yet.",
      "",
      "## Priority order for any request",
      "1. Check your memories above and any scripts logged under '## Scripts for common tasks'. If a saved script handles this request, run it with bash and return the output.",
      "2. Otherwise, do the task using the data tools and bash.",
      "3. After answering, decide whether the task could be a reusable script for next time.",
      "",
      "## When to save",
      "Append a line to memories.md when the user shares something that should color future answers:",
      "- Presentation preferences (percentages vs raw counts, terse vs detailed breakdowns, currency formatting)",
      "- Business context that's not derivable from the data (which products are seasonal, what 'normal' looks like for a metric, which stakeholder cares about what)",
      "- Explanations the user has given for past anomalies so you don't re-flag them next time",
      "- Corrections or feedback the user gave you on a prior answer",
      "",
      "Do NOT save routine questions, one-off lookups, or anything you can re-derive from the data tools.",
      "",
      "## How to use memory",
      "Read the current memories above so prior context shapes your reply.",
      "When you notice the user repeating a question, giving feedback like 'show this as %', or correcting a past answer, append a one-liner to memories.md.",
      "Don't interview the user. Capture signal opportunistically as it comes up.",
      "",
      "## Reusable scripts",
      "After answering a recurring operational question (top sellers last week, refund rate by category, weekly summary), consider writing a Python script that produces the same report on demand.",
      `Save scripts to ${SANDBOX_WORKDIR}/scripts/<name>.py so the user can re-run them later with \`python3 scripts/<name>.py\` instead of asking you again.`,
      "Stdlib only, no pandas. Make scripts self-contained and well-commented. Always invoke with `python3`, never `python`.",
      "After creating a script, log it in memories.md under '## Scripts for common tasks' with the filename and a one-line description (e.g. `top_sellers_last_week.py: top 10 SKUs by units sold in the last 7 days`).",
    ].join("\n"),
    tools: {
      bash,
      getReturnsHistory,
      getInventoryStock,
      getSalesAnalytics,
      getSupportTickets,
      searchProducts,
      getAllCategories,
    },
  });

  await agent.stream({
    messages: modelMessages,
    writable: getWritable<ModelCallStreamPart>(),
  });
}
