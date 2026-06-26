// content.js
// Runs on huggingface.co model/dataset/space listing & search pages.
//
// Design goal: behave like one of Hugging Face's OWN sidebar filters, not
// like a separate extension UI. So instead of hiding the native grid and
// drawing our own list (which looks like a different webpage), this script:
//
//   1. Finds the cards Hugging Face already rendered.
//   2. Removes (from the live DOM) any card whose author/name matches a
//      block rule — exactly as if HF itself hadn't returned that result.
//   3. Backfills by fetching more results from the public Hub API for the
//      *same query the page is already showing*, and clones a surviving
//      native card's DOM node as a template for each new one — so the
//      injected cards automatically pick up HF's current CSS, dark/light
//      theme, hover states, etc. There is no separate banner, no separate
//      section, no custom styling layer.
//
// Because we never invent our own grid container or stylesheet for the
// cards themselves, this keeps working even if HF changes class names —
// we only ever read structure from cards HF rendered moments ago.

(function () {
  const TARGET_VISIBLE_COUNT = 30; // try to keep this many cards on screen
  const FETCH_BATCH = 50;
  const DEBUG = true;
  const log = (...args) => DEBUG && console.log("[HF Hub Filter]", ...args);

  const REPO_KIND = detectRepoKind();
  log("loaded, kind:", REPO_KIND, "path:", location.pathname);
  if (!REPO_KIND) return;

  let currentRules = [];
  let lastQuery = null;
  let gridEl = null;
  let gridObserver = null;
  let applying = false; // re-entrancy guard, since our own DOM edits trigger the observer
  let injectedIds = new Set(); // ids of cards WE added, so we don't re-filter/re-count them oddly

  init();

  async function init() {
    currentRules = await window.HFFilter.loadRules();
    log("loaded rules:", currentRules);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[window.HFFilter.STORAGE_KEY]) {
        currentRules = changes[window.HFFilter.STORAGE_KEY].newValue || [];
        log("rules changed:", currentRules);
        injectedIds.clear();
        applyFiltering(true);
      }
    });

    observeUrlChanges(() => {
      injectedIds.clear();
      applyFiltering(true);
    });

    // Initial pass, plus a couple retries since HF's React grid may not have
    // rendered yet when this script first runs.
    applyFiltering(true);
    setTimeout(() => applyFiltering(true), 600);
    setTimeout(() => applyFiltering(true), 1500);
  }

  function detectRepoKind() {
    const path = location.pathname;
    if (path.startsWith("/models")) return "models";
    if (path.startsWith("/datasets")) return "datasets";
    if (path.startsWith("/spaces")) return "spaces";
    if (path.startsWith("/search")) return "models";
    return null;
  }

  function getRelevantUrlParams() {
    // Forward whatever filter/sort params the page itself is using (search,
    // pipeline_tag, library, license, language, sort, direction, author,
    // etc.) so the backfilled results match what's actually being browsed —
    // not just a plain text search. We strip out pagination params since
    // we manage paging ourselves when backfilling.
    const params = new URLSearchParams(location.search);
    params.delete("p");
    params.delete("skip");
    params.delete("limit");
    return params;
  }

  function observeUrlChanges(callback) {
    let lastUrl = location.href;
    const fire = () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        callback();
      }
    };
    new MutationObserver(fire).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", fire);
    setInterval(fire, 800);
  }

  // ---------------------------------------------------------------------
  // Card discovery: a "card" is the smallest ancestor of a repo link that
  // looks like a self-contained list item (HF wraps each result in some
  // element — article/div/li — that we can clone wholesale).
  // ---------------------------------------------------------------------

  function getRepoIdFromHref(href, kind) {
    if (!href) return null;
    const clean = href.split("?")[0].split("#")[0];
    const segments = clean.split("/").filter(Boolean);

    if (kind === "models") {
      if (segments.length !== 2) return null;
      const reserved = ["models", "datasets", "spaces", "docs", "blog", "search", "login", "join", "pricing", "settings", "papers", "collections", "tasks"];
      if (reserved.includes(segments[0])) return null;
      return segments.join("/");
    } else {
      if (segments.length !== 3 || segments[0] !== kind) return null;
      return segments.slice(1).join("/");
    }
  }

  function findCardLinks() {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const out = [];
    for (const a of anchors) {
      const repoId = getRepoIdFromHref(a.getAttribute("href"), REPO_KIND);
      if (repoId) out.push({ a, repoId });
    }
    return out;
  }

  /**
   * Given the anchors found on the page, determine the repeated "card"
   * element (one level of wrapper per result) and their shared parent grid.
   * We do this by, for each anchor, climbing until the element's tagName +
   * className signature repeats across multiple siblings — that repeated
   * signature is almost certainly the card wrapper React renders per item.
   */
  function locateGrid() {
    const links = findCardLinks();
    log("repo links found:", links.length);
    if (links.length < 2) return null;

    // For each link, walk up a few levels and remember (depth -> element).
    // We then look for the depth at which most/all links share a *parent*
    // (i.e. the grid) while each link's element-at-that-depth is a sibling.
    for (const { a } of links) {
      let node = a;
      for (let depth = 0; depth < 6 && node && node.parentElement; depth++) {
        const parent = node.parentElement;
        const siblingCount = parent.children.length;
        // Heuristic: the grid is a parent with several children that share
        // the same tagName (cards), and at least half of our discovered
        // links live directly inside one of those children.
        if (siblingCount >= 2) {
          const childTag = node.tagName;
          const sameTagSiblings = Array.from(parent.children).filter((c) => c.tagName === childTag);
          if (sameTagSiblings.length >= Math.min(2, links.length)) {
            const linksInsideSiblings = links.filter((l) =>
              sameTagSiblings.some((sib) => sib.contains(l.a))
            ).length;
            if (linksInsideSiblings >= Math.min(2, links.length) && linksInsideSiblings / links.length > 0.5) {
              return { grid: parent, cardTag: childTag, sampleCard: node };
            }
          }
        }
        node = parent;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Main filtering pass
  // ---------------------------------------------------------------------

  async function applyFiltering(force) {
    const params = getRelevantUrlParams();
    const paramsKey = params.toString();
    if (!force && paramsKey === lastQuery) return;
    lastQuery = paramsKey;

    if (currentRules.length === 0) {
      log("no rules set, leaving page untouched");
      return;
    }

    const located = locateGrid();
    if (!located) {
      log("grid not found yet, will retry");
      return;
    }
    gridEl = located.grid;

    observeGrid();
    await filterAndBackfill(params);
  }

  let lastSeenGridSignature = null;

  function observeGrid() {
    if (gridObserver) gridObserver.disconnect();
    gridObserver = new MutationObserver(() => {
      if (applying) return;
      clearTimeout(observeGrid._t);
      observeGrid._t = setTimeout(() => {
        if (currentRules.length === 0) return;
        const signature = getCurrentCardEntries().map((e) => e.repoId).join(",");
        if (signature === lastSeenGridSignature) return; // nothing actually changed, skip redundant pass
        filterAndBackfill(getRelevantUrlParams());
      }, 300);
    });
    gridObserver.observe(gridEl, { childList: true });
  }

  async function filterAndBackfill(params) {
    if (applying) return;
    applying = true;
    try {
      const cardEntries = getCurrentCardEntries();
      log("current cards in grid:", cardEntries.length);

      const survivors = [];
      let removedCount = 0;
      for (const entry of cardEntries) {
        const repo = { id: entry.repoId };
        if (window.HFFilter.isBlocked(repo, currentRules)) {
          log("removing card:", entry.repoId);
          entry.el.remove();
          removedCount++;
        } else {
          survivors.push(entry);
        }
      }

      const seenIds = new Set(survivors.map((e) => e.repoId));
      const needed = TARGET_VISIBLE_COUNT - survivors.length;
      log("removed:", removedCount, "survivors:", survivors.length, "need to backfill:", needed);

      if (needed > 0) {
        const sampleCardEl = survivors[0]?.el || findAnyTemplateCard();
        if (sampleCardEl) {
          const fresh = await fetchFilteredFresh(params, needed, seenIds);
          log("backfilling with", fresh.length, "fresh results");
          for (const repo of fresh) {
            const cloned = buildCardFromTemplate(sampleCardEl, repo);
            if (cloned) {
              gridEl.appendChild(cloned);
              injectedIds.add(repo.id);
            }
          }
        } else {
          log("no template card available to clone for backfill (grid may be empty)");
        }
      }

      lastSeenGridSignature = getCurrentCardEntries().map((e) => e.repoId).join(",");
    } catch (err) {
      console.error("[HF Hub Filter] error while filtering", err);
    } finally {
      applying = false;
    }
  }

  function getCurrentCardEntries() {
    if (!gridEl) return [];
    const entries = [];
    for (const child of Array.from(gridEl.children)) {
      const anchor = child.matches("a[href]") ? child : child.querySelector("a[href]");
      if (!anchor) continue;
      const repoId = getRepoIdFromHref(anchor.getAttribute("href"), REPO_KIND);
      if (!repoId) continue;
      entries.push({ el: child, repoId, anchor });
    }
    return entries;
  }

  function findAnyTemplateCard() {
    if (!gridEl) return null;
    return gridEl.children[0] || null;
  }

  /** Fetch results from the Hub API, skipping ones we've already seen/kept, until `count` new ones are found. */
  async function fetchFilteredFresh(params, count, excludeIds) {
    const kept = [];
    const seen = new Set(excludeIds);
    let skip = 0;
    let guard = 0;

    while (kept.length < count && guard < 10) {
      guard++;
      const batch = await fetchHubApiPage(REPO_KIND, params, FETCH_BATCH, skip);
      log("fetched API batch", { skip, size: batch.length });
      if (batch.length === 0) break;

      for (const repo of batch) {
        if (seen.has(repo.id)) continue;
        seen.add(repo.id);
        if (!window.HFFilter.isBlocked(repo, currentRules)) {
          kept.push(repo);
          if (kept.length >= count) break;
        }
      }
      skip += batch.length;
      if (batch.length < FETCH_BATCH) break;
    }
    return kept.slice(0, count);
  }

  async function fetchHubApiPage(kind, params, limit, skip) {
    const buildUrl = (p) => {
      const url = new URL(`https://huggingface.co/api/${kind}`);
      for (const [key, value] of p.entries()) {
        url.searchParams.set(key, value);
      }
      url.searchParams.set("limit", String(limit));
      if (skip) url.searchParams.set("skip", String(skip));
      return url.toString();
    };

    let res = await fetch(buildUrl(params), { headers: { Accept: "application/json" }, credentials: "omit" });

    if (!res.ok) {
      // Not every web-UI query param is guaranteed to map 1:1 onto the
      // public API (e.g. sort/direction naming can differ). Degrade
      // gracefully instead of breaking backfill entirely: retry with just
      // the search term, then with no filters at all if even that fails.
      log("API call failed with full params, retrying with reduced params. status:", res.status);
      const searchOnly = new URLSearchParams();
      if (params.has("search")) searchOnly.set("search", params.get("search"));
      res = await fetch(buildUrl(searchOnly), { headers: { Accept: "application/json" }, credentials: "omit" });
    }

    if (!res.ok) {
      res = await fetch(buildUrl(new URLSearchParams()), { headers: { Accept: "application/json" }, credentials: "omit" });
    }

    if (!res.ok) {
      throw new Error(`Hugging Face API returned ${res.status}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  // ---------------------------------------------------------------------
  // Cloning: turn a real native card into a new one for a different repo,
  // by rewriting its link target and replacing recognizable text content
  // (the bit that says "author/name") while leaving every class, every
  // icon, every layout element exactly as HF authored it.
  // ---------------------------------------------------------------------

  function buildCardFromTemplate(templateEl, repo) {
    const clone = templateEl.cloneNode(true);
    const anchor = clone.matches("a[href]") ? clone : clone.querySelector("a[href]");
    if (!anchor) return null;

    const href = REPO_KIND === "models" ? `/${repo.id}` : `/${REPO_KIND}/${repo.id}`;
    anchor.setAttribute("href", href);

    const [author, name] = repo.id.includes("/") ? repo.id.split("/") : ["", repo.id];
    const oldRepoId = getRepoIdFromHref(templateEl.matches("a[href]") ? templateEl.getAttribute("href") : templateEl.querySelector("a[href]")?.getAttribute("href"), REPO_KIND);

    // Replace every text node in the clone that exactly matched a piece of
    // the old repo id (author, name, or "author/name") with the new repo's
    // corresponding piece. This preserves all surrounding markup/icons and
    // only swaps the parts of the text that were actually the identity.
    if (oldRepoId) {
      const [oldAuthor, oldName] = oldRepoId.includes("/") ? oldRepoId.split("/") : ["", oldRepoId];
      replaceTextNodesExact(clone, oldRepoId, repo.id);
      if (oldName) replaceTextNodesExact(clone, oldName, name);
      if (oldAuthor) replaceTextNodesExact(clone, oldAuthor, author);
    }

    // Also fix any other internal links that pointed at the old repo
    // (e.g. author avatar links, "by <author>" links).
    clone.querySelectorAll("a[href]").forEach((a) => {
      const h = a.getAttribute("href");
      if (!h) return;
      const segs = h.split("?")[0].split("/").filter(Boolean);
      if (oldRepoId) {
        const oldAuthor = oldRepoId.split("/")[0];
        if (segs.length === 1 && segs[0] === oldAuthor && author) {
          a.setAttribute("href", `/${author}`);
        }
      }
    });

    clone.dataset.hfFilterInjected = "true";
    updateStatsHeuristically(clone, repo);
    return clone;
  }

  /**
   * Best-effort: find text nodes that look like a like/download count
   * (e.g. "1.2k", "800k", "42") and overwrite them with the new repo's real
   * numbers, in document order (first numeric-looking node -> likes, second
   * -> downloads). This is a heuristic because we don't control HF's markup
   * and have no stable selector for "the likes number" vs "the downloads
   * number" — it works as long as the template card shows them in the same
   * order HF always uses (likes then downloads), which matches the current
   * site layout. If HF changes this, worst case the backfilled cards show
   * slightly stale stats while the link/name itself is still correct.
   */
  function updateStatsHeuristically(clone, repo) {
    // Matches a count-like substring such as "1.2k", "800k", "1.5M", "42",
    // optionally preceded by an icon/space, anywhere inside the text node
    // — not just when the whole node is purely numeric, since real markup
    // commonly puts the icon and number in the same text node (e.g. "❤ 1.2k").
    const numericSubstring = /\d[\d.,]*\s*[kKmMbB]?\b/;
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    const numericNodes = [];
    let n;
    while ((n = walker.nextNode())) {
      // Skip anything inside the title/header area — repo names routinely
      // contain digits (e.g. "Qwen2.5-72B-Instruct") and we must never
      // mistake those for a like/download count.
      if (n.parentElement && n.parentElement.closest("header, h1, h2, h3, [class*='title' i], [class*='heading' i]")) {
        continue;
      }
      if (numericSubstring.test(n.nodeValue)) {
        numericNodes.push(n);
      }
    }
    const replacements = [];
    if (typeof repo.likes === "number") replacements.push(formatCount(repo.likes));
    if (typeof repo.downloads === "number") replacements.push(formatCount(repo.downloads));

    for (let i = 0; i < Math.min(numericNodes.length, replacements.length); i++) {
      numericNodes[i].nodeValue = numericNodes[i].nodeValue.replace(numericSubstring, replacements[i]);
    }
  }

  function formatCount(n) {
    if (typeof n !== "number") return "0";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(n);
  }

  function replaceTextNodesExact(root, oldText, newText) {
    if (!oldText || oldText === newText) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const toEdit = [];
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue && n.nodeValue.trim() === oldText) {
        toEdit.push(n);
      }
    }
    for (const node of toEdit) {
      node.nodeValue = node.nodeValue.replace(oldText, newText);
    }
  }
})();
