# Authentication Architecture — Sprint 14C

Production authentication for the Algotraders24 AI Platform, built on
**Supabase Auth** (credentials + sessions) layered over the existing
**Prisma + PostgreSQL** database (application profiles).

---

## 1. Two Sources of Truth

| Concern | System | Key |
|---|---|---|
| Credentials, sessions, email verification | Supabase Auth (`auth.users`) | Supabase UUID |
| App profile (role, plan, status) | Prisma `User` (`public.User`) | `id` (cuid) + `authId` |

The Prisma `User` row is linked to the Supabase auth user by `authId`
(the Supabase UUID, stored as `authId String? @unique`). This keeps
auth concerns and business data cleanly separated.

---

## 2. Authentication Flow

1. **Signup** — `signUpAction` -> `AuthService.signUp()` creates the Supabase
   auth user (name stored in user metadata). A verification email is sent.
2. **Login** — `signInAction` -> `AuthService.signIn()` verifies credentials
   and sets the session cookie. On first login the Prisma profile is
   provisioned automatically (see Profile Provisioning).
3. **Email verification** — the emailed link hits `/auth/callback`, which
   exchanges the code for a session and syncs `emailVerified`.
4. **Forgot password** — `forgotPasswordAction` -> `AuthService.forgotPassword()`
   emails a reset link that also returns via `/auth/callback`.
5. **Logout** — `signOutAction` -> `AuthService.signOut()` clears the session
   and redirects to `/login`.

---

## 3. Profile Provisioning (first login)

`SessionService.getSessionUser()` verifies the Supabase user, then calls
`UserRepository.findOrCreateByAuth()`:

- If a profile with this `authId` exists -> return it (sync `emailVerified`).
- Else if a row with the same email exists -> link it (set `authId`).
- Else -> create a fresh profile (`role: "user"`, `planId: "free"`,
  `status: "active"`).

This runs on login, signup, and the auth callback, so a profile always
exists for an authenticated user. There are no mock users.

---

## 4. Session Lifecycle

- Sessions are cookie-based, managed by `@supabase/ssr`.
- `middleware.ts` refreshes the session on every matched request, keeping
  cookies fresh for Server Components (which cannot write cookies).
- Verification always uses `supabase.auth.getUser()` (validates the JWT with
  Supabase) rather than `getSession()` (which only reads the cookie).

---

## 5. Protected Routes

Two layers of defense:

**Middleware (`middleware.ts`)** — guards navigation. Matched paths:
`/dashboard/*`, `/admin/*`, `/account/*`, `/api/private/*`.
- Unauthenticated page request -> redirect to `/login?redirectTo=...`
- Unauthenticated `/api/private/*` request -> `401 JSON`

**Server guards (`lib/auth/protectedRoute.ts`)** — used inside handlers:
- `requireUser()` — Server Components; redirects if not authenticated.
- `requireRole(role)` — Server Components; redirects if role mismatch.
- `getUserOrNull()` — Route Handlers; returns user or null.
- `assertRole(role)` — Route Handlers; returns `{ ok, status }`.

---

## 6. Authorization & Role System

Roles: **`admin`** and **`user`** (stored on `User.role`).

- New users default to `user`.
- `useCurrentUser()` exposes `isAdmin` on the client.
- `SessionService.hasRole()` and `requireRole()` / `assertRole()` enforce
  authorization on the server.

Client components read the user via `UserProvider` + `useCurrentUser()`;
the user object is resolved on the server and injected at mount (clients
never fetch it directly).

---

## 7. File Map

| Layer | File |
|---|---|
| Supabase clients | `lib/supabase/client.ts`, `lib/supabase/server.ts` |
| Auth operations | `services/auth/AuthService.ts` |
| Session <-> profile bridge | `services/auth/SessionService.ts` |
| Profile persistence | `repositories/UserRepository.ts` (Prisma) |
| Server actions | `app/(auth)/actions/auth.actions.ts` |
| Auth pages | `app/(auth)/login`, `/signup`, `/forgot-password` |
| Callback | `app/auth/callback/route.ts` |
| Middleware | `middleware.ts` |
| Server guards | `lib/auth/protectedRoute.ts` |
| Client context/hook | `context/UserContext.tsx`, `hooks/useCurrentUser.ts` |

---

## 8. Future Ready

The foundation supports, without architectural change:
OAuth (Google, GitHub), Magic Link, and MFA — all flow through the same
`/auth/callback` and `SessionService` provisioning path.
