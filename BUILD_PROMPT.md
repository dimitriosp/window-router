# Build Window Router from scratch

Copy the prompt below into Codex, Claude Code, or another coding agent. Give the
agent an empty folder or a new Git repository and allow it to create files and
run local tests.

---

You are a senior Chrome-extension engineer. Build a complete, production-ready
Chrome extension named **Window Router**. Use **TAB ORGANIZER** only as its UI
eyebrow, not as part of the product name. Work autonomously:
create the files, implement the extension, run the tests, fix failures, and
finish with a working folder that I can import through Chrome's **Load
unpacked** action. Do not stop after writing a plan or a code sample.

## Product goal

I often have hundreds of tabs across many Chrome windows. Window Router should
let me define website groups such as YouTube, X, LinkedIn, and GitHub. One click
must gather all open matching tabs into one dedicated Chrome window per group.
After a destination exists, future matching tabs must move there automatically.

For example, after I organize `youtube.com`, opening a YouTube link or typing
`youtube.com` into Chrome must move the loaded tab to the assigned YouTube
window. A Google search for the word “YouTube” must remain a Google tab because
the extension should route actual URLs, not infer address-bar intent.

## Technical constraints

- Use Chrome Manifest V3 and support Chrome 111 or later.
- Use plain JavaScript ES modules, HTML, and CSS. Do not use React, TypeScript,
  a framework, a bundler, or runtime dependencies.
- Do not load remote code, fonts, scripts, styles, or images.
- Do not issue background `fetch` or XHR requests and do not add analytics or
  telemetry. Normal browser navigation to a user's website is allowed.
- Keep rules and routing state inside Chrome extension storage.
- Request only the permissions required for the behavior. The expected
  permissions are `alarms`, `contextMenus`, `storage`, and `tabs`.
- Use a module service worker for background behavior.
- Keep the source understandable and split pure routing/domain logic from code
  that calls Chrome APIs.
- Use `bun` for local test and validation commands. Do not add production
  dependencies.

## Required project structure

Create at least these files:

- `manifest.json`
- `popup.html`, `popup.css`, and `popup.js`
- `options.html`, `options.css`, and `options.js`
- `src/router-core.js`
- `src/background.js`
- `tests/router-core.test.js`
- `tests/background.test.js`
- `package.json`
- `README.md`
- `SPEC.md`
- `CHANGELOG.md`

Use the popup as the extension action and `options.html` as the advanced options
page. The manifest must load `src/background.js` as a module service worker.

## Default rules

On first install, create these enabled groups:

- YouTube: `youtube.com`, `youtu.be`
- X / Twitter: `x.com`, `twitter.com`
- LinkedIn: `linkedin.com`
- GitHub: `github.com`

A domain must also match all of its subdomains. Known aliases in the same group
must always share one destination window.

## Popup behavior

Build a compact, polished popup approximately 400 pixels wide. Use a clean card
layout, strong legibility, rounded controls, and a purple primary color close to
`#675cff`. It must contain:

1. The title **Window Router** and the eyebrow **TAB ORGANIZER**.
2. A multiline field labeled **Websites**.
3. Help text that says domains can be entered one per line or separated with
   commas, spaces, or semicolons.
4. A primary button labeled **Organize all open tabs**.
5. An off-by-default switch labeled **Always create a dedicated window**.
6. A selector labeled **Auto-merge into an existing window** with the values
   **Off**, **1 tab**, **2 tabs**, **3 tabs**, and **4 tabs**. Default to Off.
7. A gear button that opens the advanced options page.
8. A short tip explaining the right-click action.
9. Clear success and error feedback without blocking JavaScript alerts.

The simple field must accept newlines, commas, semicolons, or whitespace. Trim
and lowercase values, remove protocols, paths, query strings, fragments,
leading `www.`, ports, and trailing dots. Treat a single word such as
`linkedin` as `linkedin.com`. Reject empty or invalid domain values.

When the simple field is saved, preserve an existing custom multi-domain group
if one of its domains remains in the field. Do not silently split such a group
or discard its aliases.

## One-click organizer

When the user selects **Organize all open tabs**:

- Save and enable the entered rules.
- Query all accessible open tabs. Dedicated destination windows must be normal
  browser windows.
- For each enabled rule, create or reuse exactly one dedicated window for the
  current browsing mode.
- Never assign the same destination window to two enabled rules in the same
  browsing mode. If saved bindings collide, keep one assignment and create or
  select a separate destination for the other rule.
- Move every matching open tab into that window while leaving unrelated tabs
  where they are.
- If no matching tab exists for a rule, open the group's primary homepage in
  its new dedicated window.
- If a matching tab is already in the selected destination, leave it there.
- Repeated organizer clicks must reuse the existing destination rather than
  create duplicate windows.
- The organizer must still create a dedicated window when there is only one
  matching tab. A previous destination being closed must not prevent this.
- Process rules with and without matching tabs. Count individual tab-move
  failures and return useful status information to the popup. Let an unexpected
  destination-window creation failure surface as an error.

## Automatic routing

Once a rule has an assigned destination, listen for newly created tabs and URL
changes. Move a tab after its real HTTP or HTTPS URL becomes available and
matches an enabled rule. Do not move a tab that is already in its destination.

Normal and incognito browsing must never share a destination. Never move a tab
across the incognito boundary. Only normal Chrome windows may become dedicated
destinations. A matching tab from another accessible window type may still move
to an already assigned normal destination.

If an automatic route moves the active tab, bring the destination window to the
front. Preserve pinned state when moving a pinned tab and restore it if Chrome
clears the state during the move.

Serialize mutations through one asynchronous work queue. Tab creation, URL
updates, window removal, organizer clicks, context-menu actions, and startup
recovery can arrive concurrently and must not create competing destination
windows or lose bindings.

## Optional automatic destination creation

The **Always create a dedicated window** setting is global and off by default.
When enabled, if a listed website loads and its destination no longer exists,
use that tab to create a replacement dedicated normal window and bind it to the
rule. Later matching tabs must route there.

When disabled, a newly opened matching tab must stay in its current window if
there is no assigned destination. The explicit organizer and right-click action
must still be able to create one.

## Optional auto-merge threshold

The global auto-merge threshold is 0, 1, 2, 3, or 4, where 0 means Off. It is
off by default.

When a rule has no valid destination, count matching tabs per normal window in
the same browsing mode. When one window reaches the selected threshold, adopt
the busiest qualifying window as that rule's destination. Count every domain
alias in the rule together. Break ties deterministically. Future matching tabs
must route to the adopted window.

If auto-merge and automatic creation are both enabled, first adopt a qualifying
existing window. Create a new dedicated window only when no existing window
qualifies. Do not count tabs in popup, app, or DevTools windows.

## Tab context menu

Create a tab context-menu item with the exact title **Add this site to Window
Router**. It must appear for website tabs.

When selected on a valid HTTP or HTTPS tab:

- Normalize the tab's hostname.
- Add a new enabled rule or re-enable the matching existing rule.
- Apply known aliases when relevant.
- Create or reuse that rule's dedicated window.
- Move all currently open matching tabs into it.
- Route future matching tabs there.

Do not show this action for unsupported pages such as `chrome://extensions`, and
silently ignore any unsupported URL that still reaches the event handler. Never
create invalid rules.

## Advanced options page

Create a responsive settings page where users can:

- Add a named website group.
- Edit its name and comma-separated domains.
- Enable or disable the group.
- Delete the group.
- Select **Save rules** to save without moving tabs.
- Select **Save and organize all tabs** to save and immediately organize every
  enabled group.

Validate and normalize domains before saving. Show inline success or error
status. Disabled rules must not route tabs or participate in automatic
destination creation or auto-merge.

## State and restart behavior

Use stable generated rule IDs; never use a display name as identity. Store
persistent rules and user settings in `chrome.storage.local`. Store live window
bindings in `chrome.storage.session` because Chrome window IDs are temporary.
Keep enough persistent assignment intent to know which enabled rules the user
previously organized.

Index destinations by both rule ID and browsing mode, for example
`rule-id:regular` and `rule-id:incognito`. Validate a saved window before every
move and clear its binding when Chrome reports that the window was closed.

After browser startup, schedule a short recovery pass with `chrome.alarms` so
restored tabs have time to settle. For each previously organized rule, choose
the restored normal window in the same browsing mode that already contains the
largest number of matching tabs. Bind it and route other restored matching tabs
there. Assign each restored window to at most one rule. If a mixed restored
window matches several rules, recover one assignment and leave the others
unassigned until a separate destination is available. If no matching restored
tab exists, wait for later tab activity rather than creating an empty window
without user intent. Do not run this recovery heuristic during ordinary
browsing unless the auto-merge setting is enabled.

## Core logic and safety

Keep domain parsing, hostname matching, rule sanitation, alias handling,
candidate scoring, and deterministic selection in `src/router-core.js` as pure
functions. Treat all data read from Chrome storage as untrusted: normalize it,
drop malformed records, ensure unique IDs, and restore safe defaults.

Do not inspect page contents, cookies, form data, history, or keystrokes. The
extension may inspect open-tab URLs only to match hostnames and may use Chrome
APIs only to organize tabs and windows. Never transmit browsing information.

Handle normal Chrome API races, including a tab or window disappearing between
query and move. Do not hide unexpected programming errors, but make expected
“not found” races non-fatal. Avoid infinite routing loops and duplicate event
listeners.

## Tests and acceptance criteria

Use Bun's built-in test runner. Mock the public `chrome` API surface and test
observable runtime behavior through registered listeners and runtime messages,
not private implementation details. At minimum, cover:

- Domain normalization, subdomains, invalid values, and known aliases.
- Sanitizing corrupt stored rules and keeping stable unique rule IDs.
- No automatic movement before a destination exists when both automatic
  settings are off.
- Organizing one rule, several rules, one matching tab, no matching tabs, and
  repeated organizer clicks.
- Moving future tabs after creation or URL navigation.
- Focusing the destination for an active moved tab.
- Replacing a closed destination only when automatic creation is enabled.
- Auto-merge below, at, and above thresholds 1 through 4.
- Selecting the busiest qualifying window and deterministic tie handling.
- Existing-window adoption taking priority over automatic creation.
- Auto-merge refusing a window already assigned to another rule.
- Combining aliases for threshold counts.
- Excluding non-normal windows as destination or auto-merge candidates and
  separating regular from incognito mode.
- Right-click add, existing-rule re-enable, aliases, and unsupported URLs.
- Advanced save-only versus save-and-organize behavior.
- Startup recovery from restored tabs and no ordinary-browsing recovery when
  auto-merge is off.
- Organizer repair of duplicate recovered bindings and unique window ownership
  during startup recovery.
- Pinned-tab movement.
- Concurrent or repeated events producing only one destination assignment.

The acceptance behavior must be implemented in the extension, not only mocked
or described in tests.

## Documentation and validation

Write a clear `README.md` that includes:

- What the extension does.
- Installation from GitHub: download ZIP, extract it, open
  `chrome://extensions`, enable Developer mode, select **Load unpacked**, and
  choose the folder that directly contains `manifest.json`.
- How to organize tabs, use both automatic settings, add a site by right-click,
  edit advanced rules, update an unpacked installation, and understand restart
  behavior.
- The privacy statement and the limitation about search terms versus real URLs.

Write `SPEC.md` as a concise list of required product behavior and constraints.
Maintain a dated `CHANGELOG.md` and use semantic versioning in `manifest.json`.
Every release must update both the manifest version and changelog, regardless
of the type of change it contains.
Set useful package scripts for tests and validation. Then run at least:

1. `bun test`
2. `bun build src/background.js popup.js options.js --target browser --outdir /tmp/window-router-build`
3. A manifest JSON parse check.
4. A whitespace/error check such as `git diff --check` when Git is available.

Create a distributable ZIP whose root directly contains `manifest.json`; do not
put an extra parent directory between the ZIP root and the manifest. Exclude
`.git`, tests, and other development-only files from the distributable package.

Before finishing, inspect the final file tree, confirm every manifest path
exists, rerun the complete tests, and summarize the implemented behavior,
validation results, installation steps, and any genuine remaining limitations.
