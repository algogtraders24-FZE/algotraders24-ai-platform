import { PRODUCTS } from "@/data/products";
import type { Product } from "@/types/product";

export const productService = {
  getAll: (): Product[] => PRODUCTS,
  getBySlug: (slug: string): Product | undefined => PRODUCTS.find((p) => p.slug === slug),
  getById: (id: string): Product | undefined => PRODUCTS.find((p) => p.id === id),
  getByCategory: (categoryId: string): Product[] => PRODUCTS.filter((p) => p.category === categoryId),
  getFeatured: (): Product[] => PRODUCTS.filter((p) => p.featured),
};