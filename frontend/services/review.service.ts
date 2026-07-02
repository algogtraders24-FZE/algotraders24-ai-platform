import { REVIEWS } from "@/data/reviews";
import type { Review } from "@/types/review";

export const reviewService = {
  getAll: (): Review[] => REVIEWS,
  getByProduct: (productId: string): Review[] => REVIEWS.filter((r) => r.productId === productId),
};