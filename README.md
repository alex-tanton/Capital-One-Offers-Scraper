# Capital-One-Offers-Scraper

Browser extension prototypes (Chrome + Firefox) to extract Capital One offer information from pages for local review and testing. Intended for personal and development use only.

## Repository layout

- [chrome-ext/manifest.json](chrome-ext/manifest.json) — Chrome extension manifest
- [chrome-ext/content.js](chrome-ext/content.js) — Chrome content script
- [chrome-ext/content.css](chrome-ext/content.css) — Chrome styles
- [firefox-ext/manifest.json](firefox-ext/manifest.json) — Firefox extension manifest
- [firefox-ext/content.js](firefox-ext/content.js) — Firefox content script

## Getting started

Prerequisites: Google Chrome or Mozilla Firefox.

### Load for development — Chrome

1. Open Chrome and go to `chrome://extensions/`.
2. Enable Developer mode.
3. Click "Load unpacked" and select the `chrome-ext` folder.

### Load for development — Firefox (temporary)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on" and choose the `firefox-ext/manifest.json` file (or any file inside the `firefox-ext` folder).

## Packaging

Create a distributable XPI for Firefox (PowerShell):

```powershell
Compress-Archive -Path .\firefox-ext\* -DestinationPath .\firefox-ext.xpi -Force
```

Create a ZIP for Chrome (PowerShell):

```powershell
Compress-Archive -Path .\chrome-ext\* -DestinationPath .\chrome-ext.zip -Force
```

## Development notes

- Modify [chrome-ext/content.js](chrome-ext/content.js) and [firefox-ext/content.js](firefox-ext/content.js) to change scraping behavior.

## Files of interest

- [chrome-ext/](chrome-ext/)
- [firefox-ext/](firefox-ext/)
