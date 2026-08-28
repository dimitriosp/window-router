import { normalizeDomain, normalizeRuleId } from "./src/router-core.js";

const rulesContainer = document.querySelector("#rules");
const template = document.querySelector("#rule-template");
const notice = document.querySelector("#notice");

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("error", isError);
}

function addRuleRow(rule = { id: "", name: "", domains: [], enabled: true }) {
  const row = template.content.firstElementChild.cloneNode(true);
  row.querySelector(".id").value = rule.id;
  row.querySelector(".name").value = rule.name;
  row.querySelector(".domains").value = rule.domains.join(", ");
  row.querySelector(".enabled").checked = rule.enabled;
  row.querySelector(".delete").addEventListener("click", () => row.remove());
  rulesContainer.append(row);
}

async function loadRules() {
  const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!response?.ok) throw new Error(response?.error ?? "Could not load rules.");
  rulesContainer.replaceChildren();
  response.rules.forEach(addRuleRow);
}

function readRules() {
  const rows = [...rulesContainer.querySelectorAll(".rule-row")];
  const rules = rows.map((row, index) => {
    const name = row.querySelector(".name").value.trim();
    const domains = row
      .querySelector(".domains")
      .value.split(",")
      .map(normalizeDomain)
      .filter(Boolean);
    return {
      id:
        row.querySelector(".id").value ||
        normalizeRuleId(name, `custom-${Date.now()}-${index}`),
      name,
      domains,
      enabled: row.querySelector(".enabled").checked,
    };
  });

  if (rules.some((rule) => !rule.name || rule.domains.length === 0)) {
    throw new Error("Every rule needs a name and at least one valid domain.");
  }

  return rules;
}

async function saveRules(organize = false) {
  const rules = readRules();
  const currentWindow = organize ? await chrome.windows.getCurrent() : null;

  const response = await chrome.runtime.sendMessage({
    type: organize ? "SAVE_AND_ORGANIZE_RULES" : "SAVE_RULES",
    rules,
    incognito: Boolean(currentWindow?.incognito),
  });
  if (!response?.ok) throw new Error(response?.error ?? "Could not save rules.");
  showNotice(
    organize
      ? `Rules saved. Organized ${response.moved} tabs into ${response.results.length} dedicated windows.`
      : "Rules saved.",
  );
  await loadRules();
}

document.querySelector("#add-rule").addEventListener("click", () => addRuleRow());
document.querySelector("#save").addEventListener("click", () => {
  saveRules().catch((error) => showNotice(error.message, true));
});
document.querySelector("#save-and-organize").addEventListener("click", () => {
  saveRules(true).catch((error) => showNotice(error.message, true));
});

loadRules().catch((error) => showNotice(error.message, true));
