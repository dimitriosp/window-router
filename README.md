# Window Router

Window Router organizes matching tabs into dedicated Chrome windows. Enter your
websites once, press one button, and it creates one window per website, moves
every matching open tab, and routes future tabs there automatically. It requires
Chrome 111 or later.

## Install

1. Extract the downloaded folder if you received it as a ZIP file.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** in the top-right corner.
4. Select **Load unpacked**.
5. Select the `chrome-window-router` folder that contains `manifest.json`.
6. Pin **Window Router** from Chrome's extension menu.

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
for restored tab activity to settle before choosing. Recovery stays adaptive if
more tabs appear later. If Chrome did not restore any matching tabs, the first
window that opens one becomes the recovered destination. Run **Organize all open
tabs** again if Chrome cannot infer the intended empty destination window.

## Important limitation

The extension reacts when Chrome reaches a real website URL. It cannot safely
detect that the word “YouTube” in a Google search or in the address bar was meant
as a navigation command. Opening `youtube.com` or a YouTube link is routed.

## Privacy

The extension uses Chrome's `tabs` permission to read tab URLs and move matching
tabs. Rules remain in local extension storage. No browsing data leaves Chrome,
and the extension contains no analytics, network requests, or remote code.
