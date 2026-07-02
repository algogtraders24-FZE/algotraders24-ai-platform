import type { Product } from "@/types/product";

export function formatPrice(product: Product): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: product.currency,
  }).format(product.price);
}

export function isNewRelease(product: Product): boolean {
  return daysSince(product.releaseDate) <= 30;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}