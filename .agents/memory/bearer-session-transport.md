---
name: Bearer session transport for mobile
description: How mobile clients authenticate against the cookie-session API without cookies.
---

The API uses express-session cookie sessions. Non-browser clients (Expo mobile) opt in to bearer transport instead of a parallel token system:

- Login with header `x-session-transport: bearer` → response body includes `sessionToken` (the raw session id). Web logins never receive it (token in JS would weaken the httpOnly cookie).
- A middleware before express-session synthesizes the signed `connect.sid` cookie from `Authorization: Bearer <sid>`, so the same session store, expiry, `requireAuth`, and password-change enforcement apply to both transports. Signing uses the same SESSION_SECRET.

**Why:** one session infrastructure instead of two; logout/destroy and lockout logic work identically for mobile.

**How to apply:** any new non-cookie client should reuse this header + bearer flow; never invent a separate token table. Mobile stores the token in expo-secure-store (AsyncStorage fallback on web preview), mirrors it in memory for `setAuthTokenGetter`, and validates on startup via `/auth/me` — a cached profile alone is never trusted. Expo typed-route errors (`"/x/[id]" not assignable`) mean stale `.expo/types/router.d.ts`; restarting the expo workflow regenerates it.
