export interface Review {
  id: string;
  customerId: string;
  productId: string;
  rating: number;
  title: string;
  comment: string;
  verified: boolean;
  createdAt: string;
}