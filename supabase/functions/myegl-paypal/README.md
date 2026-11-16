# MyEGL PayPal checkout

Status: live PayPal checkout is configured and enabled as of 17 November 2026 (Dubai). The live `ERSY GLOBAL MyEGL` app, OAuth credentials, notification listener and checkout creation have been verified. No customer payment was made during implementation.

## Configuration

Set these in Supabase Edge Function secrets, never in repository files, browser source, or chat:

- `PAYPAL_MODE=live`
- `PAYPAL_ENABLED=true` in production; set it to `false` to pause new checkout requests
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

Use `/myegl/payments/` while signed in as a MyEGL administrator to check OAuth credentials and readiness without charging anyone. Final readiness returned `ready=true`, `enabled=true`, `mode=live`, with credentials and the exact webhook subscription verified. The production handler was restored after the protected setup checks.

Completed checks: 20 isolated server/client tests, rolled-back database tests including approval, ownership, invoice locks, idempotency and refunds, and a real PayPal create/read check using an unpaid setup order labelled `EGL-SETUP-CHECK`. That check displayed AED 3.67 as USD 1.00 and verified the approval host and recipient through the checkout handler. No capture was attempted and no test users, jobs, invoices or payment records were saved in the portal. A completed provider sandbox buyer session and a real-money capture were not performed.

For future payment changes, use a separate PayPal sandbox fixture workflow. Do not use a customer's real invoice as a sandbox fixture. Any real-money validation payment requires separate, explicit transaction authorization.


## Branded checkout buttons

The approved customer's account now has an **Invoices and payments** section covering issued unpaid invoices from public RFQs and portal requests. The order page opens PayPal by default. Both use `myegl-paypal.js`, `myegl-paypal-buttons.js`, and `myegl-paypal.css`.

The authenticated, invoice-owned `quote` response includes the browser-safe live client ID. Client secrets and OAuth access tokens remain server-only. The JavaScript SDK v6 loads lazily from PayPal. Its eligibility check determines PayPal, guest debit/credit card, Pay Later, PayPal Credit and Venmo availability; unsupported methods are hidden. Guest card details stay in PayPal's hosted form. Apple Pay and Google Pay require separate merchant setup and are not enabled by this change.

Native sessions create funding-neutral Orders v2 orders (`checkout: buttons`), then use the existing verified server capture and webhook ledger. Prices and recipient are never accepted from the browser. A single active checkout disables competing funding buttons and invoice selection. Pending or uncertain captures require a status check before another attempt. A small secure redirect fallback remains if SDK loading fails. Draft invoices remain unpayable.

Verification for this update: 25 isolated server/UI tests; JavaScript syntax checks; actual live SDK button rendering against the business's public client ID in a private, clearly labelled fixture preview at desktop and 390px phone width. The preview had no live invoice, order-creation or capture path. A full provider buyer/capture session was not performed and no customer was charged.


## Compact payment method selector

The customer account and order page use the same three collapsed rows: **Card payment**, **PayPal**, and **Bank transfer**. One row opens at a time. Controls use real buttons with aria-expanded and labelled regions; the radio-style indicator is decorative. Bank details and the existing order reference load only when the bank row opens. Mobile styles retain full-width touch targets and wrap long account details.

Card payment renders only the eligible PayPal-hosted guest card button. The PayPal row contains wallet and eligible Pay Later/Credit/Venmo methods, without duplicating the guest card button. Stripe is not presented as an activated checkout: if card checkout is unavailable, the existing manual Stripe-link request remains available under the customer label "Request a card payment link". No Stripe settings, backend payment rules, invoice amounts or bank details changed.

Validation for this layout update: nine isolated interaction checks using the actual frontend modules and an in-memory DOM, plus syntax checks of the affected modules and page scripts. Run `node --test tests/payment-methods.test.mjs` to repeat the selector checks. Browser visual QA was unavailable in this session. No order was created or payment captured while testing this layout.


## Direct card-entry opening

Selecting the Card payment row now opens PayPal's hosted guest card-entry overlay automatically after invoice and eligibility checks. It collects card number, expiry and CVV in PayPal's environment. The application does not render or read raw card inputs. Reopening the row can reopen the same session after cancellation. A native card button remains as a retry control if the browser cannot launch the overlay automatically.

The card panel shows a concise checkout total and invoice reference. Currency conversion and potential provider/bank fees remain available in a collapsed detail. Account and order views use the same flow.

The card overlay cannot start from initial page load or from a card panel hidden during asynchronous initialization. Invoice and method selection lock while the provider form is active. Selecting a card method creates or reuses an invoice-bound checkout order; only customer approval in the provider form can lead to the existing verified capture flow. Unissued, reviewed or server-rejected invoices cannot open the form. PayPal wallet and bank rows do not start checkout merely by opening.

This uses the existing PayPal guest-card product, not Expanded Checkout's permanently embedded card fields. Expanded Checkout requires separate eligibility/merchant approval. No Stripe settings or backend payment rules were changed.

Validation: twelve isolated interaction checks using the actual modules, including direct form opening, cancellation/reopen, no hidden/background launch, duplicate-click locking, pending capture, amount integrity and no raw-card-data transmission; affected module and page syntax checks. Browser visual verification and a completed real-provider payment were unavailable in this session. No real order or payment was created while testing. Repeat with `node --test tests/payment-methods.test.mjs`.
