# AT24 MT5 Bridge

A small, **read-only** HTTP service that exposes live quotes/candles from a locally-running MetaTrader 5 terminal (Exness live account), so the main Algotraders24 app — which runs on Vercel and cannot host a persistent MT5 connection — can pull real market data from it as one more provider.

It never places, modifies, or closes a trade. There is no such endpoint in this service.

## Why this has to run on your Windows VPS

MetaTrader 5's official Python data API only works by talking to a locally-running MT5 desktop terminal over local IPC. It is not a network protocol and has no real Linux/Mac support — this service must run on the **same Windows machine** where the MT5 terminal itself is logged in and running.

## Setup (on the Windows VPS)

1. **Install Python 3.10+** if not already present (python.org, or `winget install Python.Python.3.11`).
2. **Make sure the MT5 terminal is installed and you're logged into your live Exness account**, with the terminal actually running (not just installed).
3. Copy this `mt5-bridge/` folder to the VPS.
4. Open a terminal in that folder and install dependencies:
   ```
   pip install -r requirements.txt
   ```
5. Generate a secret and set it as an environment variable (PowerShell):
   ```
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   $env:MT5_BRIDGE_SECRET = "paste-the-generated-value-here"
   ```
6. **First run — confirm your account's real symbol names** (don't skip this; guessing wrong here is the #1 way this silently returns nothing):
   ```
   uvicorn bridge:app --host 0.0.0.0 --port 8787
   ```
   Then from another terminal (or a browser with a REST client):
   ```
   curl -H "Authorization: Bearer <your secret>" http://localhost:8787/symbols
   ```
   Find the real names for XAGUSD (and anything else you want) in the returned list — e.g. it might be `XAGUSD`, `XAGUSDm`, `XAGUSD.a`, depending on your Exness account type. Edit `SYMBOL_MAP` in `bridge.py` with the real names, then restart uvicorn.
7. **Confirm a real quote**:
   ```
   curl -H "Authorization: Bearer <your secret>" "http://localhost:8787/quote?symbol=XAGUSD"
   ```
   You should see a real bid/ask. If you get a 404, the symbol name in `SYMBOL_MAP` is still wrong — go back to step 6.

## Running it continuously

Don't leave it running in a foreground terminal window — it'll die when you disconnect. Two reasonable options:

- **Task Scheduler** (simplest): create a task that runs `uvicorn bridge:app --host 0.0.0.0 --port 8787` at system startup, "run whether user is logged on or not."
- **NSSM** (Non-Sucking Service Manager): wraps the same command as a real Windows service, restarts automatically on crash. Slightly more setup, more robust.

## Exposing it to the internet (required — Vercel needs to reach it over HTTPS)

Don't expose port 8787 directly. Put a reverse proxy in front of it that terminates TLS. The simplest option is **Caddy** (single binary, automatic Let's Encrypt certificates):

1. Point a subdomain (e.g. `mt5.yourdomain.com`) at the VPS's public IP.
2. Install Caddy, then a `Caddyfile` with just:
   ```
   mt5.yourdomain.com {
       reverse_proxy localhost:8787
   }
   ```
3. Run `caddy run` (or install it as a service the same way as uvicorn above). Caddy handles the certificate automatically.
4. Open port 443 (and 80, for the ACME certificate challenge) in the VPS firewall. Do **not** open 8787 to the public internet — only Caddy should reach it, via `localhost`.

## Wiring it into the main app

Once `https://mt5.yourdomain.com/quote?symbol=XAGUSD` returns a real quote with your secret:

1. In the Next.js app's Vercel project settings, add environment variables:
   - `MT5_BRIDGE_URL=https://mt5.yourdomain.com`
   - `MT5_BRIDGE_SECRET=` (the exact same value as step 5 above)
2. Run the live smoke test from the `frontend/` directory:
   ```
   RUN_LIVE_MT5_SMOKE_TEST=1 MT5_BRIDGE_URL=https://mt5.yourdomain.com MT5_BRIDGE_SECRET=... npm run validate:mt5-provider
   ```
3. Once that passes, the instrument catalog's `verified: false` flag for the MT5/XAGUSD mapping gets flipped to `true` in a follow-up commit.

## Security notes

- The bridge secret is a bearer token with read access to your account's live prices (not funds, not trading) — treat it like any other API key: never commit it, never log it, rotate it if it leaks.
- `/health` is intentionally unauthenticated (safe — it reveals only connection status, not prices) so an uptime monitor can hit it without a credential.
- If you ever want to fully revoke access, stop the uvicorn process, or just change `MT5_BRIDGE_SECRET` and update Vercel — nothing else needs touching.
