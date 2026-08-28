# Window Router specification

## Goal

Route tabs for configured websites to a user-selected Chrome window.

## Required behavior

- Include enabled rules for YouTube, X/Twitter, LinkedIn, and GitHub.
- Let the user assign the current Chrome window as the destination for each rule.
- Move a matching tab after its URL becomes available or changes.
- Do not move a tab that is already in the assigned window.
- Keep normal and incognito window assignments separate.
- Recover a useful destination after Chrome restarts by selecting the window that
  already contains the most matching tabs.
- Let the user collect all currently open matching tabs into the current window,
  but only after an explicit click.
- Let the user add, edit, enable, disable, and delete custom domain rules.
- Keep all routing data local to Chrome. Do not send browsing data anywhere.

## Constraints

- Chrome Manifest V3.
- No runtime dependencies and no remote code.
- Importable with Chrome's **Load unpacked** action.
