// popup.js

const typeSelect = document.getElementById("rule-type");
const valueInput = document.getElementById("rule-value");
const addBtn = document.getElementById("add-btn");
const ruleList = document.getElementById("rule-list");
const emptyState = document.getElementById("empty-state");

function updateAddButtonState() {
  addBtn.disabled = valueInput.value.trim().length === 0;
}

valueInput.addEventListener("input", updateAddButtonState);
valueInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !addBtn.disabled) {
    addBtn.click();
  }
});

addBtn.addEventListener("click", async () => {
  const type = typeSelect.value;
  const value = valueInput.value.trim();
  if (!value) return;

  await window.HFFilter.addRule(type, value);
  valueInput.value = "";
  updateAddButtonState();
  await renderRules();
});

async function renderRules() {
  const rules = await window.HFFilter.loadRules();
  ruleList.innerHTML = "";

  if (rules.length === 0) {
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";

  for (const rule of rules) {
    const li = document.createElement("li");
    li.className = "rule-item";

    const tag = document.createElement("span");
    tag.className = `rule-tag rule-tag--${rule.type}`;
    tag.textContent = rule.type;

    const value = document.createElement("span");
    value.className = "rule-value";
    value.textContent = rule.value;

    const removeBtn = document.createElement("button");
    removeBtn.className = "rule-remove";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove filter";
    removeBtn.addEventListener("click", async () => {
      await window.HFFilter.removeRule(rule.id);
      await renderRules();
    });

    li.append(tag, value, removeBtn);
    ruleList.appendChild(li);
  }
}

updateAddButtonState();
renderRules();
