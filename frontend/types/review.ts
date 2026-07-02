export interface Review {
  id: string;
  customerId: string; // -> Customer.id
  productId: string; // -> Product.id
  rating: number; // 1-5
  title: string;
  comment: string;
  verified: boolean; // verified purchase
  createdAt: string;
}