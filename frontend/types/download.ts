export interface Download {
  id: string;
  customerId: string; // -> Customer.id
  productId: string; // -> Product.id
  licenseId: string; // -> License.id
  version: string;
  fileName: string;
  downloadedAt: string;
}