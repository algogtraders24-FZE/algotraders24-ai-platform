-- Demo-contest offer: a payment link can sell the listing a few percent cheaper (additive, nullable column).
ALTER TABLE "payment_links" ADD COLUMN "discountPercent" INTEGER;
