# Feature: Pay per period, no Autopay (manual renewal)

Status: **built 2026-11-14** (owner: "no need of any grace", "before the plan over just notify them", no carry-over). The owner doesn't want Autopay: "they can manually do if they need to update the plan".

## Purpose
- Today a plan is a Razorpay **Subscription**. The customer approves an Autopay mandate (UPI Autopay / card mandate / eMandate), and Razorpay charges every month or year.
- The owner wants **one payment per period** instead:
    - pay for 1 month or 1 year;
    - pay again to continue or to change plan;
    - nothing charged automatically.

## How it will work
- **Buy or renew:** Plan & Billing (or the sign-up and renew screens) create a **one-time Razorpay order** for the plan's period price. This is the same flow Brief Packs already use: the pay page, `order_id` and `payment.captured` all exist.
    - Any UPI app, card or netbanking works, with no mandate.
- **Activation:** only the signed `payment.captured` webhook turns the plan on (as today), after checking the amount against our own order. It:
    - sets plan, tier, advocates, Munshi seats and **paid until**;
    - issues the GST invoice;
    - logs the event.
- **Paid until:**
    - **Same plan, still active:** the new period is added after the current end, so renewing early never loses days.
    - **Different plan:** it starts now. The unused value of the old plan becomes extra days on the new one: unused rupees ÷ the new plan's daily price.
    - **Lapsed or free:** it starts now.
- **AI credits:** unchanged. The monthly allowance resets on the paid-until day each month, also on yearly plans.
- **Reminders:** an in-app banner from **7 days** before the end ("Your Sanad plan ends on 14 Dec. Renew now"), red on the last day. A WhatsApp reminder can come later; SMTP isn't set up.
- **After the end:** a **3-day grace period** with full access and a "Renew" banner. Then the existing gate applies: sign-in shows the plan cards and Pay.
    - Free-launch accounts go back to free until 1 Jun 2027 instead, as today.
- **Cancel:** nothing to cancel. Not renewing is cancelling.

## What changes
- **API** (`billing.service.ts`, `billing.routes.ts`):
    - checkout creates an order instead of a subscription;
    - the webhook `payment.captured` handles plans as well as packs;
    - a paid-until calculation (same, different or lapsed plan);
    - subscription code stays only to handle any old subscription safely, and nothing new creates one.
- **No migration:** `firms.renews_at` holds "paid until" and `billing_cycle` the period bought.
- **Web:**
    - "Renew" / "Pay for another month" button;
    - "Paid until …" instead of "Renews …";
    - the reminder banner;
    - checkout copy without "Autopay".
- **Legal pages:** Terms Part E and /refund-policy say plans "renew automatically" and "cancel by email". These change to "pay per period; nothing renews automatically; not renewing ends the plan". Refund rules are unchanged.
- **Razorpay:** Subscriptions are no longer used. Leave its settings as they are; the three unpaid test subscriptions expire on their own.

## Edge cases
- **Paying twice for the same period:** both payments count, each adding one period, because the amount is checked per order. Nothing is lost; refundable as an error under the policy.
- **Webhook redelivery:** only one activation and one invoice (unique payment id, as today).
- **Payment while lapsed:** activates at once and the gate opens.
- **Associates seats:** the seat check runs at checkout, as today.
- **Old Autopay subscriptions:** none are paid on live, so there's nothing to migrate.

## Acceptance criteria
1. Plan checkout creates a one-time order for the exact period price; there's no Autopay screen.
2. A signed `payment.captured` activates the right plan and seats with the right paid-until (same, different or lapsed), once, and issues one invoice.
3. A banner appears from 7 days before the end and red on the last day; access continues for 3 days after the end, then the renew gate applies.
4. Free-launch accounts fall back to free at the end, others to the renew gate.
5. The legal pages no longer mention automatic renewal or mandates.

## Owner decisions (2026-11-14), as built
- **No grace period:** access ends on the paid-until day (the existing `plan_expired` gate). Free-launch accounts fall back to free on the next request instead (plan-status.service).
- **No carry-over:** a different plan bought while one is active starts today, and its days left are not carried over (the app says so before paying). The same plan again extends from the current end.
- **Reminder:** a banner from 7 days before the end ("Your plan ends on …. Renew to keep using DifAi. Nothing is charged automatically."), red on the last day; text only on Android.
- **Checkout:** one Razorpay order per period (`notes.kind = 'plan'`). The `payment.captured` handler applies plans and packs; the Razorpay plan/subscription creation code was removed. Legacy subscription webhooks are still handled safely.
- **Return URL:** `?checkout=paid` for any order payment.
- **Legal:** Terms Part E sections 2–3 and /refund-policy say nothing renews or is charged automatically and there is nothing to cancel.
