# Xloader

A Chrome extension (Manifest V3) that records every download — when it started, the link, and the site it actually came from — and hands the list back to you in a searchable tab.

Built because "where did that file come from?" is annoying to answer. You click a link on one site, it hands you off to a file host or a CDN, and by the time the download starts the browser only knows about the host that served the bytes. Xloader remembers the whole path.

---

## Features

- **Records every download** — date and time, the download URL, the site it came from, the file host, size, MIME type and status.
- **Resolves the real origin site** — tracks the sites each tab passes through, so a download started on a file host still shows the site you came from.
- **"Check Xloads"** — right-click the extension icon for the history, or just click the icon. It opens in its own tab and stays live while downloads run.
- **Clickable links** — the file name, the download URL, the source site and the file host are all links.
- **Search and filter** — by All / Complete / Active / Failed, plus a text search across names, URLs and sites.
- **Export** — copy a single link, copy every link, or export the whole history as CSV.
- **Local only** — everything is stored in the browser profile. Nothing is uploaded anywhere.

---

## Install

### From source

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the repository folder.
5. Pin Xloader to the toolbar.

### After updating

Go to `chrome://extensions` and press the reload button on Xloader. The service worker reloads with it.

> **Note:** the download history lives in the extension's storage, so it survives reloads. Use **Clear all** in the Xloads tab to wipe it.

---

## Using it

**Right-click the Xloader icon → "Check Xloads"** opens the history tab. A plain left-click opens it too.

Each row shows:

| Column | Meaning |
| --- | --- |
| **Date / time** | When the download started, in your local timezone. |
| **File & link** | The file name, its size and type, and the full download URL. |
| **Downloaded from** | The site the download came from — the one you were browsing. |
| **file ·** | The host that actually served the bytes (the file host or CDN). |
| **Status** | Complete, Downloading, or Failed. |

Hovering the site name shows the full path it was reached through, for example `lewdcorner.com → pixeldrain.com`.

The two icon buttons on the right copy the download link and reveal the finished file in Explorer.

---

## How the origin site is worked out

A download usually does not start on the site you were reading. Links hop through a redirector, a file host, or a CDN first, and Chrome only tells the extension about the host that ended up serving the file.

So Xloader keeps a short chain of the sites each tab passes through:

```
lewdcorner.com  →  pixeldrain.com
```

When a download starts, the **source site** is the last site in that chain that is not the host serving the file. The file host is listed separately.

That resolves the common cases:

| What you did | Downloaded from | File host |
| --- | --- | --- |
| Followed a lewdcorner.com link to pixeldrain | `lewdcorner.com` | `pixeldrain.com` |
| The link redirected to another CDN | `lewdcorner.com` | `cdn.example.net` |
| Opened the file host in a new tab | `lewdcorner.com` | `pixeldrain.com` |
| Went straight to pixeldrain and downloaded | `pixeldrain.com` | `pixeldrain.com` |
| Right-click → Save link as, no page | the referring site | the file host |

The chain also covers links that open in a **new tab** (the new tab inherits the history of the tab it came from) and downloads that start with **no tab at all** (the referrer is matched against the tab that was showing that page).

---

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `downloads` | Reading what was downloaded, and revealing finished files in Explorer. |
| `storage` | Keeping the history, locally. |
| `contextMenus` | The "Check Xloads" entry on the extension's right-click menu. |
| `tabs` | Seeing which site a tab moved to, so the origin site can be resolved. |

There are **no host permissions** — the extension is not granted access to the pages you visit, and it does not read their content.

---

## Privacy

Everything is written to `chrome.storage.local` in the browser profile and never leaves the machine. There is no server, no analytics and no network access of any kind.

The per-tab site chain is kept in `chrome.storage.session`, which is cleared when the browser closes.

---

## Project layout

```
manifest.json         Extension manifest (MV3)
background.js         Service worker: download tracking, site chain, context menu
lib/xstore.js         Storage helpers and the source-site resolution rules
xloads.html/css/js    The history tab
icons/                Toolbar icons
tools/make-icons.ps1  Regenerates the icons (Windows)
```

## Development

```powershell
# regenerate the toolbar icons
powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
```

The service worker is plain ES modules — no build step, no dependencies. Open `chrome://extensions` → **Service worker** to watch the console while downloads happen.

## Notes and limits

- The origin site is resolved from the tabs that were open in the current browser session, so it reflects how you actually reached the file.
- Downloads started by another extension, or by a background service with no tab and no referrer, fall back to the file host.
- The history keeps the most recent 2000 downloads.
