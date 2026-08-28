# Window Router specification

## Goal

Organize open tabs into dedicated website windows with one action, then route
future matching tabs to those windows.

## Required behavior

- Include enabled rules for YouTube, X/Twitter, LinkedIn, and GitHub.
- Let the user enter domains in one text field, separated by newlines, commas,
  semicolons, or spaces.
- Let the user press one button to create or reuse one dedicated window per
  entered domain group and move all matching open tabs there.
- Let the user right-click a website tab and add its domain to Window Router
  without copying and pasting it.
- After the right-click action, create or reuse a dedicated window, move all
  open tabs from that domain into it, and route future matching tabs there.
- Ignore tabs that do not use HTTP or HTTPS, such as Chrome settings pages.
- Do not require the user to create or visit destination windows manually.
- Treat a single word such as `linkedin` as `linkedin.com`.
- Keep known aliases together: `youtube.com` with `youtu.be`, and `x.com` with
  `twitter.com`.
- Preserve multi-domain groups created in the advanced rules page when their
  domain remains in the simple organizer field.
- Move a matching tab after its URL becomes available or changes.
- Do not move a tab that is already in the assigned window.
- Keep normal and incognito window assignments separate.
- Recover a useful destination after Chrome restarts by selecting the window that
  already contains the most matching tabs.
- Move existing tabs only after the explicit bulk-organize click.
- Let the user add, edit, enable, disable, and delete custom domain rules.
- Let the user save advanced rules and organize every enabled rule in one action.
- Keep all routing data local to Chrome. Do not send browsing data anywhere.

## Constraints

- Chrome Manifest V3.
- No runtime dependencies and no remote code.
- Importable with Chrome's **Load unpacked** action.
