# HF Hub Filter

A browser extension for Opera GX (and any Chromium-based browser) that lets
you hide specific models, datasets, or spaces from Hugging Face Hub listing
and search pages — filtered by **author/username** or by **name keyword**.

Example: browse/search "Qwen" but never see anything from the user
`lordx64`. Filtered results are backfilled so you still see a full page,
not a shorter list with gaps.

## How it works (and how it doesn't)

This does **not** draw a separate panel, banner, or list. It edits Hugging
Face's own results grid in place, the same way one of HF's own sidebar
filters (task, library, license, etc.) would:

1. It finds the cards Hugging Face already rendered on the page.
2. Any card whose author or name matches one of your rules is **removed
   directly from the live page**, exactly as if Hugging Face itself hadn't
   returned that result.
3. To keep the page full, it fetches more results for the same
   search/filter the page is already showing (using Hugging Face's public
   Hub API), and **clones one of the surviving native cards** as a
   template for each new one — swapping in the new repo's name, link, and
   stats. Because it's a real clone of HF's own markup, it automatically
   matches HF's current layout, fonts, spacing, and light/dark theme, with
   zero custom styling of its own.
4. It watches the results grid for changes (sorting, scrolling,
   pagination, switching tabs) and re-applies filtering automatically.

This works on plain browsing too — e.g. just visiting
`huggingface.co/models` with no search term — not only when a `search=`
query is present.

The native cards aren't deleted from Hugging Face, just from your local
DOM; reloading the page brings them back, and clearing all your filters
stops any further changes.

## Installing in Opera GX

1. Download/unzip this folder somewhere permanent (don't delete it after
   installing — Opera loads the extension directly from these files).
2. Open Opera GX and go to `opera://extensions`.
3. Toggle on **Developer mode** (top-right).
4. Click **Load unpacked**.
5. Select the `hf-filter-extension` folder (the one containing
   `manifest.json`).
6. The shield icon should appear in your toolbar.

This also works the same way in Chrome, Edge, Brave, or Vivaldi via
`chrome://extensions` / `edge://extensions` etc.

## Usage

1. Click the extension icon in the toolbar.
2. Choose **Author** or **Name**, type the value, and click **Add filter**.
   - **Author**: exact-matches a Hugging Face username/org (e.g. `lordx64`)
   - **Name**: matches any repo whose name or full id contains this text
     (e.g. `uncensored`, `abliterated`, `gguf`)
3. Go to `huggingface.co/models` (or `/datasets`, `/spaces`, `/search`),
   with or without a search term. As soon as you have at least one active
   filter, matching cards disappear from the grid and get replaced.
4. Remove a filter any time from the popup — reload the page to restore
   any previously-removed cards.

If the Hugging Face API call for backfilling ever fails (e.g. you're
offline), the page is simply left as-is — blocked cards stay removed, but
no broken or blank cards are inserted in their place.

## Files

- `manifest.json` — extension definition (Manifest V3)
- `content.js` — runs on huggingface.co; finds the results grid, removes
  blocked cards, and clones survivors to backfill new ones
- `filters.js` — shared rule storage/matching logic
- `popup.html` / `popup.js` — the toolbar popup UI for managing filters
- `background.js` — minimal service worker, initializes storage on install
- `icons/` — toolbar icon

## Known limitations

- **Tags/pipeline pill on backfilled cards**: the name, link, and
  like/download counts on a backfilled card are corrected to match the
  real new repo, but a secondary tag/pill (e.g. "text-generation") is left
  as whatever the template card had, since there's no reliable way to
  identify that specific element without depending on Hugging Face's
  internal class names. In practice this is a minor cosmetic detail since
  most results for the same search share the same pipeline tag anyway.
- **Like/download count matching is a heuristic**: it looks for
  number-shaped text (e.g. "1.2k", "800k") in the cloned card and swaps it
  for the real numbers in order (likes, then downloads), skipping anything
  inside the title/heading so model names with digits in them (e.g.
  "Qwen2.5-72B") are never mistaken for a stat. If Hugging Face changes the
  order stats appear in, backfilled cards could show a like count where a
  download count belongs — the name and link are unaffected either way.
- **Non-search filter params**: when the page uses filters beyond a plain
  text search (license, library, sort order, etc.), the extension forwards
  those to the Hub API for backfilling. If a particular param doesn't
  match the API's accepted names, it automatically retries with just the
  search term, then with no filters, so backfill degrades gracefully
  rather than breaking.
- **"Name" rules match a substring** in `<author>/<name>`, so a name
  filter for `gguf` will also remove `someone/gguf-tools`. Use an Author
  filter when you specifically want to block one user/org entirely.

