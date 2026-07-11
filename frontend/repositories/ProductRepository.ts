// repositories/ProductRepository.ts
// Sprint 14A — Backend Foundation

import type { BaseEntity } from "@/types/backend";
import { BaseRepository } from "./BaseRepository";

export interface ProductEntity extends BaseEntity {
  name: string;
  slug: string;
  price: number;
  status: "active" | "draft" | "archived";
}

const SEED: ProductEntity[] = [
  {
    id: "prod_1",
    name: "AI Trading Bot Pro",
    slug: "ai-trading-bot-pro",
    price: 199,
    status: "active",
    createdAt: "2026-01-10T09:00:00.000Z",
    updatedAt: "2026-01-10T09:00:00.000Z",
  },
];

export class ProductRepository extends BaseRepository<ProductEntity> {
  protected entityName = "product";

  constructor() {
    super(SEED);
  }
}
