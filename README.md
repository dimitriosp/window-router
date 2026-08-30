# Window Router

Window Router organizes matching tabs into dedicated Chrome windows. Enter your
websites once, press one button, and it creates one window per website, moves
every matching open tab, and routes future tabs there automatically. It requires
Chrome 111 or later.

## Install from GitHub

1. Select **Code** on this GitHub page, then select **Download ZIP**.
2. Extract the downloaded ZIP file.
3. Open `chrome://extensions` in Chrome.
4. Enable **Developer mode** in the top-right corner.
5. Select **Load unpacked**.
6. Select the extracted folder that contains `manifest.json`.
7. Pin **Window Router** from Chrome's extension menu.

Chrome does not automatically update extensions installed this way. Download a
new release, replace the local files, and select **Reload** on
`chrome://extensions` when you want to update it.

## Build it yourself with an AI coding agent

Want to recreate or customize the extension yourself? Copy the complete
[Window Router build prompt](BUILD_PROMPT.md) into Codex, Claude Code, or
another coding agent. It contains the product behavior, architecture, privacy
constraints, tests, and delivery checklist needed to build the extension from
an empty folder.

## Organize your tabs

1. Select the Window Router toolbar icon from any Chrome window.
2. Enter one website per line. Commas, spaces, and semicolons also work.
3. Select **Organize all open tabs**.

Example:

```text
youtube.com
x.com
linkedin
github.com
```

The extension creates or reuses four dedicated windows and moves the matching
tabs from all your existing Chrome windows. Unrelated tabs stay where they are.
Running the organizer again reuses the same dedicated windows.

After organization, newly opened tabs and tabs that navigate to a matching
domain move automatically. If the moved tab was active, Chrome brings its
destination window to the front.

### Automatically replace closed destination windows

Enable **Always create a dedicated window** in the popup if you want Window
Router to create a replacement automatically. When Chrome opens a listed site
and no destination window remains, that tab becomes the new dedicated window.
Later matching tabs route there. Turn the setting off to require the organizer
or right-click action to create replacement windows.

The setting reacts to website URLs. Typing `linkedin.com` works after Chrome
loads LinkedIn; searching Google for the word `LinkedIn` remains a Google tab.

### Automatically adopt an existing website window

Use **Auto-merge into an existing window** to choose a threshold from 1 to 4
tabs. If no destination is assigned and one window reaches that number of tabs
for the same listed website, Window Router adopts the busiest matching window.
New matching tabs move there automatically. Select **Off** to disable this
behavior.

If both automatic settings are enabled, Window Router first looks for an
existing window that reaches the threshold. It creates a new dedicated window
only when none qualifies.

## Add a website from its tab

Right-click a website tab and select **Add this site to Window Router**. The
extension adds that website to your rules, creates or reuses its dedicated
window, and moves every open tab from the same domain into it. Future tabs from
that domain route to the same window automatically.

This action works on normal `http://` and `https://` website tabs. Chrome pages,
such as `chrome://extensions`, are not added.

Single words receive `.com`, so `linkedin` becomes `linkedin.com`. YouTube links
from `youtu.be` share the YouTube window. `twitter.com` shares the X window.

## Custom rules

Select the gear icon in the popup. You can add a name and comma-separated
domains, such as `notion.so, notion.site`. A domain automatically includes its
subdomains. Select **Save rules** to save only, or **Save and organize all tabs**
to save and immediately organize every enabled website group.

## Restart behavior

Chrome window IDs do not survive a complete browser restart. Window Router
remembers which rules you organized, then recovers by selecting the restored
window that contains the most matching tabs. During startup, it waits briefly
for restored tab activity to settle before choosing. One recovered window can
belong to only one website group, so a mixed window is never reused as the
destination for several rules. Recovery stays adaptive if more tabs appear
later. If Chrome did not restore any matching tabs, the first window that opens
one becomes the recovered destination. Run **Organize all open tabs** again if
Chrome cannot infer the intended empty destination window.

## Important limitation

The extension reacts when Chrome reaches a real website URL. It cannot safely
detect that the word “YouTube” in a Google search or in the address bar was meant
as a navigation command. Opening `youtube.com` or a YouTube link is routed.

## Privacy

The extension uses Chrome's `tabs` permission to read tab URLs and move matching
tabs. Rules remain in local extension storage. No browsing data leaves Chrome,
and the extension contains no analytics, network requests, or remote code.
