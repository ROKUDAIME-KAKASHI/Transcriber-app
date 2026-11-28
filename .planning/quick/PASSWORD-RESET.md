# Password reset (Forgot password)

Stateless: no table, no schema change. Token = base64url(JSON{uid, exp (30 min), ph}) + "." + HMAC-SHA256 keyed from `NEXTAUTH_SECRET`.
`ph` is a fingerprint of the current password hash, so after any password change every older link stops working.
Code: `src/lib/resetToken.ts`, `src/app/api/auth/forgot`, `src/app/api/auth/reset`, pages `/forgot` and `/reset`.

## Env vars
- `NEXTAUTH_SECRET` (already required): signs the tokens. Rotating it invalidates outstanding links.
- `RESEND_API_KEY` and `BOOKING_FROM_EMAIL` (same as booking emails). Without both, `GET /api/auth/forgot` returns `{enabled:false}` and the login page shows "Ask the app owner to reset it" instead of a link.
- `NEXTAUTH_URL` (optional here): used as the link origin; falls back to the request URL.

## Test
1. `npm test` (token: valid, expired, tampered, password-changed) and `node scripts/smoke.mjs` (/forgot, /reset answer 200).
2. Manual (local dev with the env vars set): login page shows "Forgot password?"; submit an email; open the emailed link; set a new password; the same link then says "expired or was already used".
3. Unknown email gets the same message and no mail.

## Limits
- Existing JWT sessions (up to NextAuth's 30 days) are not revoked on reset; that would need a schema change.
- Rate limits (3 per email and 10 per IP per hour on /forgot, 10 per IP per hour on /reset) are in-memory, per serverless instance.
- The service worker passes /forgot and /reset straight to the network (never the offline shell).
