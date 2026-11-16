# MyEGL PayPal checkout

Status: backend deployed, checkout intentionally disabled pending secret storage and real provider validation. A live app named `ERSY GLOBAL MyEGL` exists in the business PayPal account. No customer payment has been made during implementation.

## Configuration

Set these in Supabase Edge Function secrets, never in repository files, browser source, or chat:

- `PAYPAL_MODE=live`
- `PAYPAL_ENABLED=false` until connection verification and provider testing are complete
- `PAYPAL_LIVE_CLIENT_ID` from the live MyEGL app
- `PAYPAL_LIVE_CLIENT_SECRET` from the same app
- `PAYPAL_LIVE_WEBHOOK_ID` for the listener below
- `PAYPAL_RECEIVER_EMAIL=sales@ersygloballogistics.com`

Listener: `https://mycknhzaadlaopqjpnpi.supabase.co/functions/v1/myegl-paypal/webhook`

Subscribe to `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, and `PAYMENT.CAPTURE.REVERSED`. The function verifies every webhook with PayPal's signature verification endpoint and fetches the order/refund independently. Reversed payments require administrator reconciliation; refunds adjust the original invoice balance and block another automatic payment until reviewed.

The Edge Function uses its own `auth.getUser` check (`verify_jwt=false` is required for provider webhooks and modern publishable keys). Customer operations also require a confirmed, currently approved account and ownership. Only the backend service role can reserve or apply payment records. Public health checks are not available; the health action requires a MyEGL administrator.

## Payment rules

Only issued invoices matching an approved quotation are payable. The server reads the remaining balance, fixes the recipient, and uses a persistent idempotency key for each order and capture. AED balances convert to USD at **1 USD = 3.6725 AED**, rounded to two decimal places, with both values shown before checkout. USD, EUR and GBP invoices retain their currency. GHS invoices require a supported-currency invoice; they are never relabelled or silently converted. Provider and bank conversion fees may apply; no surcharge is added by this implementation.

An order reservation is reused for up to two hours. Capturing or pending payments block competing invoice/quote edits, while completed payments apply once. Test payments cannot mark live invoices paid. The return URL alone never marks a payment received. Refund rounding is cumulative in the original invoice currency, so a full refund restores the full balance.

## Verification

Run `node --test tests/paypal-payment.test.mjs tests/paypal-customer-ui.test.mjs` from the repository root. These use isolated mocks, never real payments. `tests/paypal-database.sql` checks amount conversion, approval, ownership, duplicate reservation/capture, edit locks, partial/full refunds, and RLS inside a rolled-back transaction. Do not remove the rollback.

After secrets are saved, use `/myegl/payments/` while signed in as a MyEGL administrator to check OAuth credentials and readiness without charging anyone. Complete a PayPal sandbox provider test in a separate sandbox fixture workflow before enabling customer checkout. Do not use a customer's real invoice as a sandbox fixture. A real-money validation payment requires the user's separate, explicit transaction authorization.
