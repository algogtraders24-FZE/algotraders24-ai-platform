// services/product.service.ts
// Sprint 14E - Product catalogue is now database-backed.
// Call load() once, then the existing synchronous accessors work unchanged.
import type { Product } from "@/types/product";
import { ProductsApi } from "@/services/api/ProductsApi";

class ProductService {
  private products: Product[] = [];
  private loaded = false;
  private inFlight: Promise<void> | null = null;

  isLoaded(): boolean {
    return this.loaded;
  }

  async load(
    options: { signal?: AbortSignal; force?: boolean } = {}
  ): Promise<void> {
    if (this.loaded && !options.force) return;
    if (this.inFlight && !options.force) return this.inFlight;

    if (options.force) ProductsApi.invalidate();

    this.inFlight = ProductsApi.listAll({ signal: options.signal }).then(
      (items) => {
        this.products = items;
        this.loaded = true;
      }
    );

    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  getAll(): Product[] {
    return this.products;
  }

  getBySlug(slug: string): Product | undefined {
    return this.products.find((p) => p.slug === slug);
  }

  getById(id: string): Product | undefined {
    return this.products.find((p) => p.id === id);
  }

  getByCategory(categoryId: string): Product[] {
    return this.products.filter((p) => p.category === categoryId);
  }

  getFeatured(): Product[] {
    return this.products.filter((p) => p.featured);
  }
}

export const productService = new ProductService();