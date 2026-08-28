# Window Router

Window Router sends matching tabs to a Chrome window that you choose. It ships
with rules for YouTube, X/Twitter, LinkedIn, and GitHub, and supports custom
domain groups. It requires Chrome 111 or later.

## Install

1. Extract the downloaded folder if you received it as a ZIP file.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** in the top-right corner.
4. Select **Load unpacked**.
5. Select the `chrome-window-router` folder that contains `manifest.json`.
6. Pin **Window Router** from Chrome's extension menu.

## Set up a destination window

1. Go to the Chrome window that should hold a site's tabs.
2. Select the Window Router toolbar icon.
3. Find the website and select **Use this window**.
4. Repeat in the destination window for each website group.

Use **Collect tabs here** when you also want to move all currently open tabs for
that website into the current window. Collection only runs after an explicit
click.

Once assigned, newly opened tabs and tabs that navigate to a matching domain
move automatically. If the moved tab was active, Chrome brings its destination
window to the front.

## Custom rules

Select the gear icon in the popup. You can add a name and comma-separated
domains, such as `notion.so, notion.site`. A domain automatically includes its
subdomains.

## Restart behavior

Chrome window IDs do not survive a complete browser restart. Window Router
remembers which rules you assigned, then recovers by selecting the restored
window that contains the most matching tabs. During startup, it waits briefly
for restored tab activity to settle before choosing. Recovery stays adaptive if
more tabs appear later. If Chrome did not restore any matching tabs, the first window
that opens one becomes the recovered destination. Use **Use this window** again
if Chrome cannot infer the intended empty destination window.

## Important limitation

The extension reacts when Chrome reaches a real website URL. It cannot safely
detect that the word “YouTube” in a Google search or in the address bar was meant
as a navigation command. Opening `youtube.com` or a YouTube link is routed.

## Privacy

The extension uses Chrome's `tabs` permission to read tab URLs and move matching
tabs. Rules remain in local extension storage. No browsing data leaves Chrome,
and the extension contains no analytics, network requests, or remote code.
