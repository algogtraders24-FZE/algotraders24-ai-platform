# Algotraders24 AI — Business Architecture

Business domain models aur unke rishte. No backend — abhi mock data + services.

## Core Entities

- **Product** — bikne wala software (EA, indicator, bot). Source of truth.
- **Customer** — kharidne wala user.
- **Order** — ek purchase. Kis customer ne kaunse product kharide.
- **License** — purchase ke baad mila activation key. Product use karne ka adhikaar.
- **Download** — customer ne kaunsi file/version download ki.
- **Subscription** — recurring plan (signals, research). Product se alag.
- **Review** — customer ka product pe rating + comment.

## Relationships

- Customer 1 → * Order (ek customer ke kai orders)
- Order * → * Product (ek order me kai items)
- Customer 1 → * License (har purchase = license)
- License 1 → 1 Product (license kisi ek product ka)
- Customer 1 → * Download (download license + product se juda)
- Customer 1 → * Subscription (recurring plans)
- Customer 1 → * Review → 1 Product

ID se linking: Order.customerId → Customer.id, License.productId → Product.id, etc.

## Layers

UI (components/pages) → Services → Data

- **Services** (services/*.service.ts) — sirf yahan data aata hai
- **Data** (data/*.ts) — abhi mock, future me API/Supabase

UI kabhi seedha data import nahi karta — hamesha service se. Isliye future me data source badalne pe UI nahi chhedna padega.

## Future Ready

- Services ke andar fetch()/Supabase daal do → UI same rahega.
- Auth aane par Customer = logged-in user.
- Stripe aane par Order.status payment webhook se update hoga.