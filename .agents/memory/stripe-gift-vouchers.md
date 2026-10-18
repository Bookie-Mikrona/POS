---
name: Stripe and gift vouchers
description: Pointers to gift-voucher payment, redemption, and operational notification rules.
---

- [Card payment for gift vouchers](gift-voucher-card-payment.md)
- [Merchant-direct Stripe vouchers](stripe-boni-po-gostincu.md)
- [POS redemption of online vouchers](pos-spletni-bon-unovcenje.md)
- [Stripe operational email](stripe-operational-email.md)
- [Stripe operational notifications](stripe-operational-notifications.md)

**Why:** Voucher payment, fiscal redemption, and delivery notifications are distinct stages; an ambiguous or duplicated side effect can affect payment integrity or mislead the buyer.

**How to apply:** Follow the linked stage-specific contract, preserve idempotency and merchant ownership, and do not treat best-effort notification acceptance as confirmed delivery.
