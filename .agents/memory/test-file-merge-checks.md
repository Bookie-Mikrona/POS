---
name: Test-file merge checks
description: Protect integration-test structure when rebasing overlapping changes.
---

After rebasing overlapping test-file changes, inspect the complete diff against the new base and verify that each assertion remains inside the intended test. A conflict-free merge can still displace code into another test or outside the test suite, and can change unrelated fixture inputs.

**Why:** A concurrent merge silently combined adjacent integration tests and left valid-looking request code outside its intended scope; the first full typecheck exposed it.

**How to apply:** Before accepting a rebase result, review changed test blocks and fixture setup, then run the focused typecheck and test file.
