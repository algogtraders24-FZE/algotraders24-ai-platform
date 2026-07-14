// services/api/ProductsApi.ts
// Sprint 14E - Typed access to the product catalogue API.
import { ApiClient, type RequestOptions } from "./ApiClient";
import type { Product } from "@/types/product";

interface ProductListEnvelope {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProductQuery {
  page?: number;
  pageSize?: number;
  category?: string;
  featured?: boolean;
}

// The catalogue changes rarely; cache it for a few minutes.
const CATALOGUE_TTL_MS = 3 * 60 * 1000;

export class ProductsApi {
  static async list(
    query: ProductQuery = {},
    options: RequestOptions = {}
  ): Promise<ProductListEnvelope> {
    return ApiClient.get<ProductListEnvelope>("/api/private/products", {
      cacheTtlMs: CATALOGUE_TTL_MS,
      retries: 2,
      query: {
        page: query.page,
        pageSize: query.pageSize ?? 100,
        category: query.category,
        featured: query.featured ? "true" : undefined,
      },
      ...options,
    });
  }

  static async listAll(options: RequestOptions = {}): Promise<Product[]> {
    const data = await ProductsApi.list({ pageSize: 100 }, options);
    return data.items;
  }

  static invalidate(): void {
    ApiClient.invalidate("/api/private/products");
  }
}