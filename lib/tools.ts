/**
 * This is where the tools for your agent will live.
 *
 * During the workshop you'll define tools in this file that your agents
 * will choose to run depending on the question or request that is made
 * to them.
 *
 * Workshop docs: https://agent-foundations-certification.vercel.app/docs/tools
 */

import { tool } from "ai";
import { z } from "zod";
import { ApiRequestError, getBackOfficeReturns, getBackOfficeSales, getBackOfficeStock, getBackOfficeSupportTickets, getCategories, getProducts, getProductById, getProductStock } from "@/lib/api";
import { start } from "workflow/api";
import { returnFlow } from "./workflows/return-flow";
import { createOrGetSandbox, ensureWorkdir, SANDBOX_NAME, SANDBOX_WORKDIR } from "@/lib/sandbox";
import type { Product } from "@/lib/types";

export const searchProducts = tool({
    description: `BROAD LOOKUP. Search the Vercel swag store catalog and return a short list of matching products (id, name, price, one image, short description).
                  Use this when the user is browsing, comparing, asking what the store sells, or wants recommendations, or when you need to find the id of an item they named.
                  Do NOT use this to answer detailed questions about one specific item (sizes, stock, all photos, full details); call getProductDetails with the product's id or slug for that.
                  Optionally narrow results to a single category.`,
    inputSchema: z.object({
        query: z
            .string()
            .optional()
            .describe(
                "Optional free-text search terms describing what the user is looking for, e.g. 'hoodie' or 'water bottle'."
            ),
        category: z
             .string()
             .optional()
             .describe(
                "Optional category slug to filter results. Only set this when the user clearly wants a specific category. Use the getAllCategories tool to get all valid categories.",
             ),
     }),
     execute: async ({ query, category }) => {
        "use step";
        try {
            const products = await getProducts({
                search: query,
                        category,
                limit: 10,
            });
            return {
                count: products.length,
                products: products.map((p) => ({
                    id: p.id,
                    name: p.name,
                    slug: p.slug,
                    image: p.images[0],
                    price: p.price,
                    currency: p.currency,
                    category: p.category,
                    description: p.description,
                })),
            };
        } catch (err) {
            const message = 
                err instanceof ApiRequestError ? err.message : "Unknown error";
            return { count: 0, products: [], error: message };
        }
     },
});

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "OS", "ONE SIZE"];

// The API's Product type has no dedicated sizes field. Use one if the API
// sends it, otherwise pick size labels out of the product's tags.
function extractSizes(product: Product): string[] {
    const raw = (product as Product & { sizes?: unknown }).sizes;
    if (Array.isArray(raw)) return raw.map(String);
    const found = product.tags
        .map((t) => t.trim().toUpperCase().replace(/^SIZE[:\-\s]*/, ""))
        .filter((t) => SIZE_ORDER.includes(t));
    return [...new Set(found)].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b));
}

export const getProductDetails = tool({
    description: `SINGLE ITEM. Get the full, live details for ONE specific product: full description, price, every image, available sizes, tags, live stock level, and a few related products from the same category.
                  Use this whenever the user asks about a particular item ("tell me more about the black hoodie", "is the mug in stock?", "what sizes does the tee come in?", "show me the backpack").
                  Pass the product's id or slug. If you only know the item's name, call searchProducts first to find its id, then call this tool.
                  The UI renders the result as a product card, so do not repeat the image, price or stock in your text; add a short, helpful comment instead.`,
    inputSchema: z.object({
        idOrSlug: z
            .string()
            .describe("The product's id or slug, as returned by searchProducts, e.g. 'black-hoodie'."),
    }),
    execute: async ({ idOrSlug }) => {
        "use step";
        try {
            const product = await getProductById(idOrSlug);

            // Stock and related products are nice-to-have: if either call
            // fails we still return the product details.
            const [stockResult, relatedResult] = await Promise.allSettled([
                getProductStock(product.id),
                getProducts({ category: product.category, limit: 5 }),
            ]);

            const stock =
                stockResult.status === "fulfilled"
                    ? {
                          available: stockResult.value.stock,
                          inStock: stockResult.value.inStock,
                          lowStock: stockResult.value.lowStock,
                      }
                    : null;

            const related =
                relatedResult.status === "fulfilled"
                    ? relatedResult.value
                          .filter((p) => p.id !== product.id)
                          .slice(0, 3)
                          .map((p) => ({
                              id: p.id,
                              name: p.name,
                              slug: p.slug,
                              image: p.images[0],
                              price: p.price,
                              currency: p.currency,
                          }))
                    : [];

            return {
                found: true as const,
                product: {
                    id: product.id,
                    name: product.name,
                    slug: product.slug,
                    description: product.description,
                    price: product.price, // integer cents
                    currency: product.currency,
                    category: product.category,
                    images: product.images,
                    sizes: extractSizes(product),
                    tags: product.tags,
                    featured: product.featured,
                },
                stock,
                related,
            };
        } catch (err) {
            if (err instanceof ApiRequestError && err.status === 404) {
                return { found: false as const, error: `No product found for "${idOrSlug}". Try searchProducts to find the right id.` };
            }
            const message =
                err instanceof ApiRequestError ? err.message : "Unknown error";
            return { found: false as const, error: message };
        }
    },
});

export const getAllCategories = tool({
    description: "List every product category available in the Vercel swag store, along with the number of products in each. Use this when the user asks what categories exist, what kinds of products are sold, or wants to browse the store at a high level.",
    inputSchema: z.object({}),
    execute: async () => {
        "use step";
        try {
            const categories = await getCategories();
            return {
                count: categories.length,
                categories: categories.map((c) => ({
                    slug: c.slug,
                    name: c.name,
                    productCount: c.productCount,
                })),
            };
        } catch (err) {
            const message =
                err instanceof ApiRequestError ? err.message : "Unknown error";
            return { count: 0, categories: [], error: message };
        }
    },
});

export const returnOrder = tool({
    description: "File a return for one of the user's past orders. The user must provide an order ID and a reason. Example order IDs: 11111, 22222, 33333. The return is processed in the background, so tell the user it has been received and is being processed.",
    inputSchema: z.object ({
        orderId: z
            .string()
            .describe("The order ID the user wants to return."),
        reason: z
            .string()
            .min(10)
            .max(500)
            .describe("Why the user is returning the order."),
    }),
    execute: async ({ orderId, reason }) => {
        "use step";
        // Launch the durable return workflow and return immediately. It keeps
        // running (and retrying) in the background.
        const run = await start(returnFlow, [orderId, reason]);
        return { runId: run.runId, message: `Return request received for order ${orderId}.` };
    },
});

// ---------------------------------------------------------------------------
// Back-office (admin agent) tools. Read-only.
// ---------------------------------------------------------------------------

export const getSupportTickets = tool({
    description: `List support tickets from the back office within a date range. Each ticket includes status, priority, category, assignee (staff username or null when unassigned), the related customer/order, and timestamps. Use this for triaging the support queue, spotting spikes in a category, checking workload by assignee, or auditing unresolved urgent tickets. History covers ~last 180 days. Summarize across the rows in your reply rather than dumping them; for more than ~10 rows of arithmetic, note that exact joins and aggregates are limited until a sandbox tool is added.`,
    inputSchema: z.object({
        from: z
            .string()
            .optional()
            .describe(
                `ISO 8601 datetime or YYYY-MM-DD. Defaults to 30 days before "to". If the user gives a vague window ("this month", "recently"), pick a sensible range, state it explicitly in your reply, and proceed.`,
            ),
        to: z
            .string()
            .optional()
            .describe(`ISO 8601 datetime or YYYY-MM-DD. Defaults to now.`),
        status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        category: z
            .enum(["shipping", "returns", "product_quality", "sizing", "billing", "payment", "account", "other"])
            .optional(),
        assignee: z
            .string()
            .optional()
            .describe(`Staff username (e.g. "alex"). When set, unassigned tickets are excluded.`),
        limit: z.number().int().min(1).max(500).optional(),
    }),
    execute: async ({ from, to, status, priority, category, assignee, limit }) => {
        "use step";
        try {
            const { data, meta } = await getBackOfficeSupportTickets({ from, to, status, priority, category, assignee, limit });
            return { count: data.length, tickets: data, range: meta };
        } catch (err) {
            const message =
                err instanceof ApiRequestError ? err.message : "Unknown error";
            return { count: 0, tickets: [], error: message };
        }
    },
});

export const getReturnsHistory = tool({
    description: `List historical returns from the back office within a date range. Each entry includes the items returned, the decision (approved/rejected/needs_info), refund amount in cents (divide by 100 for dollar amounts in your reply), and a summary of the related order. Use this for return triage, refund auditing, or identifying products with high return volumes. History covers ~last 180 days. Summarize across the returned rows in your reply rather than dumping them; for more than ~10 rows of arithmetic, note that exact joins and aggregates are limited until a sandbox tool is added.`,
    inputSchema: z.object({
        from: z
            .string()
            .optional()
            .describe(
                `ISO 8601 datetime or YYYY-MM-DD. Defaults to 30 days before "to". If the user gives a vague window ("this month", "recently"), pick a sensible range, state it explicitly in your reply, and proceed.`,
            ),
        to: z
            .string()
            .optional()
            .describe(`ISO 8601 datetime or YYYY-MM-DD. Defaults to now.`),
        status: z.enum(["pending", "processing", "completed"]).optional(),
        decision: z.enum(["approved", "rejected", "needs_info"]).optional(),
        limit: z.number().int().min(1).max(500).optional(),
    }),
    execute: async ({ from, to, status, decision, limit }) => {
        "use step";
        try {
            const { data, meta } = await getBackOfficeReturns({ from, to, status, decision, limit });
            return { count: data.length, returns: data, range: meta };
        } catch (err) {
            const message =
                err instanceof ApiRequestError ? err.message : "Unknown error";
            return { count: 0, returns: [], error: message };
        }
    },
});

export const getInventoryStock = tool({
    description: `Current stock levels for all products (or a subset). Results are sorted by stock ascending, so out-of-stock and low-stock items appear first. Use this to answer questions about availability, restocking priorities, or which items are about to run out. Summarize the rows in your reply rather than dumping them.`,
    inputSchema: z.object({
        productIds: z
            .array(z.string())
            .optional()
            .describe(`Restrict the query to specific product ids.`),
        lowStock: z
            .boolean()
            .optional()
            .describe(`true = only items with 1–5 units in stock; false = exclude low-stock items.`),
        inStock: z
            .boolean()
            .optional()
            .describe(`true = only items with at least one unit; false = only zero.`),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(200).optional(),
    }),
    execute: async ({ productIds, lowStock, inStock, page, limit }) => {
        "use step";
        try {
            const { data, meta } = await getBackOfficeStock({ productIds, lowStock, inStock, page, limit });
            return { count: data.length, stock: data, pagination: meta.pagination };
        } catch (err) {
            const message =
                err instanceof ApiRequestError ? err.message : "Unknown error";
            return { count: 0, stock: [], error: message };
        }
    },
});

export const getSalesAnalytics = tool({
    description: `Sales totals by product within a date range. Each row reports unitsSold, ordersCount, and revenue in cents (divide by 100 for dollar amounts in your reply). Results are sorted by unitsSold descending. Pair with getReturnsHistory to compute per-product return rates. Sales data covers ~last 180 days. Summarize across the rows in your reply rather than dumping them; for more than ~10 rows of arithmetic, note that exact joins and aggregates are limited until a sandbox tool is added.`,
    inputSchema: z.object({
        from: z
            .string()
            .optional()
            .describe(
                `ISO 8601 datetime or YYYY-MM-DD. Defaults to 30 days before "to". If the user gives a vague window ("this month", "recently"), pick a sensible range, state it explicitly in your reply, and proceed.`,
            ),
        to: z
            .string()
            .optional()
            .describe(`ISO 8601 datetime or YYYY-MM-DD. Defaults to now.`),
        productId: z
            .string()
            .optional()
            .describe(`Restrict to a single product. 404s if it doesn't exist.`),
    }),
    execute: async ({ from, to, productId }) => {
        "use step";
        try {
            const { data, meta } = await getBackOfficeSales({ from, to, productId });
            return { count: data.length, sales: data, summary: meta };
        } catch (err) {
            const message =
                err instanceof ApiRequestError ? err.message : "Unknown error";
            return { count: 0, sales: [], error: message };
        }
    },
});

export const bash = tool({
    description: `Run a bash command in the persistent sandbox. Commands run in ${SANDBOX_WORKDIR}, which holds memories.md and scripts/.`,
    inputSchema: z.object({
        command: z.string().describe("The bash command to run"),
    }),
    execute: async ({ command }) => {
        "use step";
        const sandbox = await createOrGetSandbox(SANDBOX_NAME);
        await ensureWorkdir(sandbox);
        // Run from the workdir so relative paths like memories.md and
        // scripts/<name>.py land in the folder readMemories reads from.
        const result = await sandbox.runCommand({
            cmd: "bash",
            args: ["-lc", command],
            cwd: SANDBOX_WORKDIR,
        });
        return {
            stdout: await result.stdout(),
            stderr: await result.stderr(),
            exitCode: result.exitCode,
        };
    },
});
