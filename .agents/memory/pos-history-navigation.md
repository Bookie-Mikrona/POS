---
name: POS Back/Forward guard
description: Preserve browser history destinations when an unsaved POS draft blocks route traversal.
---

When a dirty POS draft blocks browser Back or Forward, preserve the original history destination and traversal distance. Return the browser to the current entry while the warning is open; after discard, resume the same traversal, and after cancel, clear the pending attempt. Do not substitute router navigation or a new pushed URL.

**Why:** `popstate` fires after the browser has already changed its active entry. A fresh route push can lose the intended destination or truncate the Forward stack.

**How to apply:** Keep browser-history interception centralized with POS route navigation. Test clean and changed drafts in both directions, and verify that canceling leaves the same history usable.
