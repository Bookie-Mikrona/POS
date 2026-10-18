---
name: One-time cheaper supplier offer
description: Choosing a cheaper offer for a reorder draft must not change the article's preferred supplier.
---

A buyer's choice to use a cheaper supplier offer while preparing one order is a one-time document choice. It must not update the article's saved preferred supplier or the supplier used by future default reorder suggestions.

**Why:** A lower price can be useful for an individual purchase without representing a lasting preference; silently changing the default would affect future orders.

**How to apply:** Build the draft from the selected supplier mapping and its package factor. Only the explicit article-settings flow may save a new preferred mapping.
