# Capital One Offers Loader

![Version](https://img.shields.io/badge/Version-1.0.1-orange.svg)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue.svg)

Are you tired of endlessly scrolling through Capital One Offers to find the best deals? **Capital One Offers Loader** is a powerful Google Chrome extension that supercharges your experience! It automatically loads all available offers instantly, providing advanced searching, sorting, and filtering options directly on the Capital One Offers feed page (`capitaloneoffers.com/feed*`). Say goodbye to pagination and hello to maximizing your rewards effortlessly!

## Features

- **Load All Deals**: Automatically pages through and retrieves all active Capital One offers via the internal feed API.
- **Persistent Caching**: Caches loaded deals in browser storage so your offers persist across page navigations without needing to re-fetch.
- **Reload / Refresh**: Includes a "Reload Deals" button to clear cached deals and fetch fresh offers.
- **Instant Search**: Real-time search filter for loaded deals by merchant name, online/in-store availability, or reward details.
- **Reward Type Filtering**: Filter deals by reward type:
  - `% Back`
  - `$ Back (Up To)`
  - `$ Back (Flat)`
  - `Earning Rate` (multiplier e.g. 9X miles)
  - `Bonus Miles (Up To)`
  - `Bonus Miles (Flat)`
- **Sorting**: Toggle sorting to view highest reward offers first.
- **Native Deal Activation**: Clicking any deal tile integrates with Capital One's underlying offer activation flow or navigates directly to the offer details.

## Repository Layout

- [chrome-ext/manifest.json](chrome-ext/manifest.json) — Manifest V3 extension configuration
- [chrome-ext/content.js](chrome-ext/content.js) — Content script handling session extraction, deal pagination, caching, UI controls, search, and filtering
- [chrome-ext/content.css](chrome-ext/content.css) — Styles for extension toolbar, grid, filters, and cards
- [chrome-ext/icons/](chrome-ext/icons/) — Extension icon assets

## Getting Started

### Prerequisites

- Google Chrome (or any Chromium-based browser supporting Manifest V3).

### Installation (Development Mode)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the [chrome-ext](chrome-ext/) directory from this repository.
6. Navigate to [capitaloneoffers.com/feed](https://capitaloneoffers.com/feed) and log into your Capital One account to use the extension toolbar.

## Packaging

To package the extension into a zip file for distribution (e.g., via PowerShell on Windows):

```powershell
Compress-Archive -Path .\chrome-ext\* -DestinationPath .\chrome-ext.zip -Force
```

## Development Notes

- The extension executes in the page context (`MAIN` world) to read session state and interact seamlessly with React/Remix state.
- Edit [chrome-ext/content.js](chrome-ext/content.js) to adjust API parameters, delay intervals, or scraping logic.
- Edit [chrome-ext/content.css](chrome-ext/content.css) to adjust the UI toolbar or deal card styling.
