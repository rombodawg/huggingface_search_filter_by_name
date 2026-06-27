## Installing the extension

This is a Manifest V3 extension and works in any Chromium-based browser. Load it as an "unpacked" extension via your browser's extensions page:

| Browser       | Extensions page URL       |
|----------------|---------------------------|
| Opera / Opera GX | `opera://extensions`    |
| Google Chrome  | `chrome://extensions`     |
| Microsoft Edge | `edge://extensions`       |
| Brave          | `brave://extensions`      |
| Vivaldi        | `vivaldi://extensions`    |
| Arc            | `arc://extensions`        |

**Steps (same for all of the above):**
1. Make sure you have git installed
2. `git clone https://github.com/rombodawg/huggingface_search_filter_by_name.git`
3. Open your browser's extensions page from the table above
4. Enable **Developer mode** (usually a toggle in the top-right corner)
5. Click **Load unpacked**
6. Double click to enter the cloned `huggingface_search_filter_by_name` folder (the one containing `manifest.json`)
7. Click "Select" on the open window

> **Firefox is not supported.** Firefox uses a different extension format (Manifest V2/V3 with different APIs, loaded via `about:debugging#/runtime/this-firefox` or signed `.xpi` packaging), and this extension hasn't been ported to it.

(Developer note: Extension is currently buggy, sometimes requiring a browser refresh after filters are applied, or after going to the next page, in order for results to display correctly.)
