---
name: Validation during parallel task merges
description: How to attribute broad validation failures while project tasks are merging concurrently.
---

When a broad validation chain fails in a package unrelated to the assigned change, inspect the current file and its recent merge history before classifying the failure as pre-existing or skipping validation. Concurrent task merges can introduce defects into otherwise untouched files; a parse error may be only the first visible symptom of several corrupted handlers.

**Why:** A recent merge inserted an unrelated database query into an account-breakdown loop, so the shared API typecheck failed during a POS-only printing task.

**How to apply:** Read the exact validation log, compare the full changed file with the latest relevant commit's parent, and check each affected route or test boundary—not just the first compiler error. Make only clearly corrective changes that restore intended behavior; otherwise, report the unrelated blocker rather than hiding it with skipped validation.

Completion can incorporate a newer base after local checks succeed. A passing local typecheck therefore does not rule out a newly introduced compile failure in the completion check.

**Why:** Successive completion attempts incorporated unrelated supplier-order test and route changes after those same files had passed local checks.

**How to apply:** After each rejected completion, inspect the current commit history and the exact new failure before editing. Preserve intentional changes from other work while restoring only demonstrably corrupted blocks; do not assume the second failure has the same cause as the first.
