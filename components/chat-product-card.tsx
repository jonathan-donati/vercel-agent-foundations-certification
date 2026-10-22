"use client";

/**
 * Product cards rendered inline in the agent chat from tool results.
 * - <ChatProductDetailsCard> renders a `getProductDetails` result.
 * - <ChatProductList> renders a `searchProducts` result as a compact grid.
 */

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  image?: string;
  price: number;
  currency: string;
}

export interface ProductDetailsOutput {
  found: boolean;
  error?: string;
  product?: ProductSummary & {
    description: string;
    category: string;
    images: string[];
    sizes: string[];
    tags: string[];
    featured: boolean;
  };
  stock?: { available: number; inStock: boolean; lowStock: boolean } | null;
  related?: ProductSummary[];
}

export interface SearchProductsOutput {
  count: number;
  error?: string;
  products: (ProductSummary & { description?: string })[];
}

const productHref = (p: { slug: string }) => `/products/${p.slug}`;

function StockBadge({ stock }: { stock: ProductDetailsOutput["stock"] }) {
  if (!stock) return <Badge variant="outline">Stock unavailable</Badge>;
  if (!stock.inStock) return <Badge variant="destructive">Out of stock</Badge>;
  if (stock.lowStock)
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-900">
        Only {stock.available} left
      </Badge>
    );
  return <Badge variant="secondary">In stock ({stock.available})</Badge>;
}

export function ChatProductDetailsCard({ data }: { data: ProductDetailsOutput }) {
  const [active, setActive] = useState(0);
  if (!data.found || !data.product) {
    return (
      <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
        {data.error ?? "Product not found."}
      </div>
    );
  }
  const p = data.product;
  const images = p.images.length ? p.images : [];

  return (
    <div className="w-full max-w-sm overflow-hidden rounded-lg border border-border bg-card">
      {images[active] && (
        <div className="relative aspect-square bg-secondary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[active]} alt={p.name} className="h-full w-full object-cover" />
        </div>
      )}
      {images.length > 1 && (
        <div className="flex gap-2 px-3 pt-3">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show image ${i + 1} of ${p.name}`}
              className={cn(
                "size-12 overflow-hidden rounded border",
                i === active ? "border-foreground" : "border-border opacity-70",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-medium text-foreground">{p.name}</h3>
            <p className="text-xs capitalize text-muted-foreground">{p.category}</p>
          </div>
          <p className="font-semibold">{formatPrice(p.price, p.currency)}</p>
        </div>

        <StockBadge stock={data.stock} />

        <p className="text-sm text-muted-foreground">{p.description}</p>

        {p.sizes.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">Sizes</p>
            <div className="flex flex-wrap gap-1">
              {p.sizes.map((s) => (
                <Badge key={s} variant="outline">{s}</Badge>
              ))}
            </div>
          </div>
        )}

        {data.related && data.related.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium">You might also like</p>
            <div className="grid grid-cols-3 gap-2">
              {data.related.map((r) => (
                <Link key={r.id} href={productHref(r)} className="group block">
                  <div className="aspect-square overflow-hidden rounded bg-secondary">
                    {r.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.image} alt={r.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{formatPrice(r.price, r.currency)}</p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatProductList({ data }: { data: SearchProductsOutput }) {
  if (data.error) {
    return <div className="text-sm text-muted-foreground">Search failed: {data.error}</div>;
  }
  if (!data.products.length) return null;
  return (
    <div className="grid w-full grid-cols-2 gap-2">
      {data.products.map((p) => (
        <Link
          key={p.id}
          href={productHref(p)}
          className="group block overflow-hidden rounded-lg border border-border bg-card hover:border-foreground/20"
        >
          <div className="aspect-square overflow-hidden bg-secondary">
            {p.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.image} alt={p.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
            )}
          </div>
          <div className="p-2">
            <p className="truncate text-xs font-medium">{p.name}</p>
            <p className="text-xs text-muted-foreground">{formatPrice(p.price, p.currency)}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
