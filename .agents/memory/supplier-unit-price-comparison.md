---
name: Supplier unit-price comparison
description: Canonical unit pricing when a supplier's package factor changes after a receipt.
---

Use the stored last price per base unit (`zadnjaCenaEnota`) for supplier comparisons. Do not derive it from the stored package price and the current package factor: a factor edit does not rewrite the historical package price. Historical price lists likewise use each confirmed receipt's saved `neto_cena` per base unit, business date, and receipt reference rather than today's package factor.

**Why:** A package factor can change after a receipt while the saved package and unit prices remain unchanged. Dividing the historical package price by the new factor would show a false comparable price.

**Why:** Reconstructing old prices from the current factor would alter the historical record; the confirmed receipt's net unit price is the stable amount to compare over time.

**How to apply:** Before showing an offer comparison, require valid nonnegative recorded prices and a positive finite current factor. Use the stored unit price for ranking; do not claim a historical package price belongs to the current package size without a matching snapshot. For history, keep each confirmed receipt's stored unit price and date together with its reference.
