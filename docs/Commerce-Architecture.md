# Commerce Architecture

## Order Flow
Cart → Checkout session → Order (pending) → Payment → Order (paid) → License issued.

## Payment Flow (future)
provider (stripe/crypto/paypal) → payment.service → webhook → Payment.status=completed.

## Invoice Flow
Paid order → Invoice generated (invoiceNumber) → downloadable.

## Future Stripe
checkout.service.createSession → Stripe Checkout; webhook updates Payment + Order.

## Future Crypto
Same session; on-chain confirmation → Payment.status.

Services mock; UI unchanged when real providers added.