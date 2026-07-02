import type { Review } from "@/types/review";

export const REVIEWS: Review[] = [
  { id: "r1", customerId: "c1", productId: "p1", rating: 5, title: "Consistent results", comment: "Best EA I've used. Stress-free trading.", verified: true, createdAt: "2025-07-01" },
  { id: "r2", customerId: "c2", productId: "p2", rating: 4, title: "Runs 24/7", comment: "Catches moves I would have missed.", verified: true, createdAt: "2025-08-20" },
  { id: "r3", customerId: "c3", productId: "p3", rating: 5, title: "Worth every dollar", comment: "The smart money indicator alone is worth it.", verified: true, createdAt: "2025-10-05" },
];