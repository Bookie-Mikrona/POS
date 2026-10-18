---
name: POS UI interaction rules
description: Pointers to keyboard, dialog, file-picker, and browser-history edge cases.
---

When editing POS forms and dialogs, apply the specific interaction rule rather than relying on default browser or event behavior:

- [Form keyboard navigation](form-navigation.md)
- [Escape in dropdowns inside dialogs](escape-dropdown-dialog.md)
- [Native file pickers inside dialogs](native-file-picker-dialog.md)
- [Back and Forward with unsaved drafts](pos-history-navigation.md)

**Why:** POS form workflows depend on keyboard use and browser controls, while framework event phases and native file-picker focus can behave differently from ordinary click handling.

**How to apply:** Open the linked note that matches the interaction being changed and preserve its stated behavior in tests.
