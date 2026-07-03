# Authentication Architecture

Architecture-only foundation. No backend/Supabase yet — mock service.

## Roles
- **Guest** — not logged in
- **Customer** — bought products; dashboard + orders
- **Affiliate** — affiliate dashboard
- **Admin** — full access

## Auth Flow (future)
1. User logs in → auth.service.login()
2. Session created (User + token + expiresAt)
3. middleware.ts checks session on protected routes
4. Role decides permissions (lib/permissions.ts)

## User Lifecycle
Guest → Login → Customer/Affiliate/Admin → Session active → Logout/Expire → Guest

## Route Protection
- Protected: /dashboard, /admin, /account (middleware matcher)
- Public: /, /products, /pricing, /about, /contact
- middleware.ts abhi block nahi karta (TODO tak).

## Future Supabase Integration
- auth.service methods ke andar Supabase calls daalein.
- Session Supabase se aayegi; UI/callers same rahenge.
- Roles Supabase user metadata me store honge.

## Layers
UI → auth.service → (future) Supabase
Permissions: role → hasPermission(role, permission)