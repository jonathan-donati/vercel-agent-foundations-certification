"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { formatPrice } from "@/lib/format";
import type { ProductDetailsToolInvocation } from "@/lib/agent";

interface AgentProductCardProps {
  invocation: ProductDetailsToolInvocation;
}

type StockInfo = { available: number; inStock: boolean; lowStock: boolean } | null;

function StockBadge({ stock }: { stock: StockInfo }) {
  if (!stock) {
    return <span className="text-xs text-muted-foreground">Stock unavailable</span>;
  }
  if (!stock.inStock) {
    return (
      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        Out of stock
      </span>
    );
  }
  if (stock.lowStock) {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
        Only {stock.available} left
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
      In stock
    </span>
  );
}

export function AgentProductCard({ invocation }: AgentProductCardProps) {
  const [activeImage, setActiveImage] = useState(0);

  if (
    invocation.state === "input-streaming" ||
    invocation.state === "input-available"
  ) {
    const id = invocation.input?.idOrSlug;
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Looking up{id ? ` "${id}"` : ""}…
      </div>
    );
  }

  if (invocation.state === "output-error") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {invocation.errorText}
      </div>
    );
  }

  if (invocation.state !== "output-available") return null;

  const output = invocation.output;

  if (!output) return null;

  // getProductDetails returns { found: false, error } when the lookup fails.
  if (!output.found) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {output.error}
      </div>
    );
  }

  const { product, stock, related } = output;
  const image = product.images[activeImage] ?? product.images[0];

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {image && (
        <div className="relative aspect-4/3 bg-secondary">
          <Image
            src={image}
            alt={product.name}
            fill
            sizes="(min-width: 768px) 480px, 100vw"
            className="object-cover"
          />
        </div>
      )}

      {product.images.length > 1 && (
        <div className="flex gap-2 px-4 pt-3">
          {product.images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setActiveImage(i)}
              aria-label={`Show image ${i + 1} of ${product.name}`}
              className={`relative size-12 overflow-hidden rounded-md border ${
                i === activeImage ? "border-foreground" : "border-border opacity-70"
              }`}
            >
              <Image src={src} alt="" fill sizes="48px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold leading-tight">{product.name}</h3>
            <p className="text-sm text-muted-foreground">
              {formatPrice(product.price, product.currency)}
            </p>
          </div>
          <StockBadge stock={stock} />
        </div>

        <p className="line-clamp-3 text-sm text-muted-foreground">{product.description}</p>

        {product.sizes.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">Sizes</p>
            <div className="flex flex-wrap gap-1">
              {product.sizes.map((size) => (
                <span
                  key={size}
                  className="rounded-md border border-border px-2 py-0.5 text-xs"
                >
                  {size}
                </span>
              ))}
            </div>
          </div>
        )}

        {product.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {product.tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <Link
          href={`/products/${product.slug}`}
          className="inline-flex text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          View product →
        </Link>

        {related.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="mb-2 text-xs font-medium">You might also like</p>
            <div className="grid grid-cols-3 gap-2">
              {related.map((r) => (
                <Link key={r.id} href={`/products/${r.slug}`} className="group block">
                  <div className="relative aspect-square overflow-hidden rounded-md bg-secondary">
                    {r.image && (
                      <Image
                        src={r.image}
                        alt={r.name}
                        fill
                        sizes="96px"
                        className="object-cover transition-transform group-hover:scale-105"
                      />
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatPrice(r.price, r.currency)}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
