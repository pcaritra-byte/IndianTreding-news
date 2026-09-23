# MarketPulse India — Paper Trading + Live Market Data

This version adds an optional **Upstox live market-data connection** while keeping all orders paper/simulated.

## What changed
- Live NIFTY 50, BANK NIFTY, RELIANCE and TCS quote updates through the backend.
- Upstox OAuth login button.
- Optional manual `UPSTOX_ACCESS_TOKEN` configuration.
- The browser never receives your Upstox client secret.
- Automatic demo fallback when no live credential is configured.
- Paper orders remain local and do not submit real trades.

## Important Upstox authentication detail
Current Upstox market quote requests use a **Bearer access token**. The API key/client ID and client secret are used by the OAuth login flow to obtain that access token.

## Setup
1. Install Node.js 18 or newer.
2. Copy `.env.example` to `.env`.
3. Fill in `UPSTOX_CLIENT_ID` and `UPSTOX_CLIENT_SECRET` from your Upstox developer app.
4. Register this redirect URI in the Upstox app:
   `http://localhost:3000/auth/callback`
5. In this folder run:
   `node server.js`
6. Open:
   `http://localhost:3000`
7. Click **Live API → Login with Upstox**.

### Manual token option
Instead of OAuth login, you can put a currently valid `UPSTOX_ACCESS_TOKEN` in `.env`. The token is then used by the server for `/api/quotes`.

## Notes
- Upstox access tokens have a limited validity period, so a token can expire and require re-authentication.
- The included API connector is intentionally server-side so client secrets are not exposed in HTML/JavaScript.
- The dashboard still works in DEMO mode without credentials.
- For deployment, use HTTPS and a secure secret store rather than committing `.env` to source control.
