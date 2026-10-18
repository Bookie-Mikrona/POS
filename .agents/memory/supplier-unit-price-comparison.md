---
name: Supplier unit-price comparison
description: Canonical unit pricing when a supplier's package factor changes after a receipt.
---

Use the stored last price per base unit (`zadnjaCenaEnota`) for supplier comparisons. Do not derive it from the stored package price and the current package factor: a factor edit does not rewrite the historical package price. Historical price lists likewise use each confirmed receipt's saved `neto_cena` per base unit, business date, and receipt reference rather than today's package factor.

When one confirmed receipt has multiple linked lines for the same supplier mapping, represent that receipt once using the positive-quantity-weighted average of its saved net unit prices. Apply the same rule to the cached latest price and its receipt reference.

**Why:** A package factor can change after a receipt while the saved package and unit prices remain unchanged. Dividing the historical package price by the new factor would show a false comparable price.

**Why:** Reconstructing old prices from the current factor would alter the historical record; the confirmed receipt's net unit price is the stable amount to compare over time.

**Why:** Selecting one duplicate line by ID could pair a receipt reference with a misleading price. Weighting by received base quantity reflects the actual combined net cost of the receipt and keeps the dashboard's latest-price cache consistent with history.

**How to apply:** Before showing an offer comparison, require valid nonnegative recorded prices and a positive finite current factor. Use the stored unit price for ranking; do not claim a historical package price belongs to the current package size without a matching snapshot. For history, keep each confirmed receipt's stored unit price and date together with its reference.

For the supplier reorder comparison, mark a price stale at 90 or more calendar days, using the current `Europe/Ljubljana` date. If no dated source receipt exists, show its age as unknown rather than fresh; retain the price for context instead of removing it from comparison.

**Why:** The user selected the 90-day threshold. A stored price without a dated receipt cannot establish freshness, but it may still be useful as historical context.

**How to apply:** Apply the threshold only to comparable prices. Keep the receipt link and date visible for stale entries, and handle missing or invalid dates as unknown.
