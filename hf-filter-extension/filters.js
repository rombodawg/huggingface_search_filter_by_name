// filters.js
// Shared logic for reading/writing the user's blocklist rules.
//
// A rule is one of:
//   { type: "author", value: "lordx64" }       -> blocks any repo owned by this user/org
//   { type: "name",   value: "qwen2.5-leak" }  -> blocks repo names/ids containing this text
//
// Rules are stored in chrome.storage.local under the key "hfFilterRules"
// so they persist across browser restarts and are shared between the
// popup UI and the content script running on huggingface.co.

const HF_FILTER_STORAGE_KEY = "hfFilterRules";

/** Load all rules. Always resolves to an array (possibly empty). */
async function loadRules() {
  const data = await chrome.storage.local.get(HF_FILTER_STORAGE_KEY);
  const rules = data[HF_FILTER_STORAGE_KEY];
  return Array.isArray(rules) ? rules : [];
}

/** Persist the full rule list. */
async function saveRules(rules) {
  await chrome.storage.local.set({ [HF_FILTER_STORAGE_KEY]: rules });
}

/** Add a rule, de-duping on (type, lowercased value). Returns the new list. */
async function addRule(type, rawValue) {
  const value = rawValue.trim();
  if (!value) return loadRules();

  const rules = await loadRules();
  const normalized = value.toLowerCase();
  const exists = rules.some(
    (r) => r.type === type && r.value.toLowerCase() === normalized
  );
  if (!exists) {
    rules.push({ type, value, id: `${type}:${normalized}:${Date.now()}` });
    await saveRules(rules);
  }
  return loadRules();
}

/** Remove a rule by its id. Returns the new list. */
async function removeRule(id) {
  const rules = await loadRules();
  const next = rules.filter((r) => r.id !== id);
  await saveRules(next);
  return next;
}

/**
 * Decide whether a repo should be blocked.
 * @param {{id: string, author?: string}} repo - repo.id is like "lordx64/qwen2.5-uncensored"
 * @param {Array} rules
 */
function isBlocked(repo, rules) {
  if (!rules || rules.length === 0) return false;

  const fullId = (repo.id || "").toLowerCase();
  const author = (repo.author || fullId.split("/")[0] || "").toLowerCase();
  const nameOnly = fullId.includes("/") ? fullId.split("/").slice(1).join("/") : fullId;

  for (const rule of rules) {
    const needle = rule.value.toLowerCase();
    if (!needle) continue;

    if (rule.type === "author") {
      if (author === needle) return true;
    } else if (rule.type === "name") {
      if (nameOnly.includes(needle) || fullId.includes(needle)) return true;
    }
  }
  return false;
}

// Expose on window for content.js (classic script, no modules in MV3 content scripts by default)
// and via CommonJS-ish export for popup.js (loaded as a normal script in popup.html too).
if (typeof window !== "undefined") {
  window.HFFilter = {
    loadRules,
    saveRules,
    addRule,
    removeRule,
    isBlocked,
    STORAGE_KEY: HF_FILTER_STORAGE_KEY,
  };
}
