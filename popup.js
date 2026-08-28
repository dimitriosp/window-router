const rulesContainer = document.querySelector("#rules");
const template = document.querySelector("#rule-template");
const notice = document.querySelector("#notice");
let currentWindow;

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("error", isError);
  notice.style.display = "block";
  window.setTimeout(() => {
    notice.style.display = "none";
  }, 2800);
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error ?? "The extension did not respond.");
  return response;
}

async function render() {
  currentWindow = await chrome.windows.getCurrent();
  const { rules, bindings, intents } = await send({ type: "GET_STATE" });
  rulesContainer.replaceChildren();

  for (const rule of rules) {
    const card = template.content.firstElementChild.cloneNode(true);
    const key = `${rule.id}:${currentWindow.incognito ? "incognito" : "regular"}`;
    const binding = bindings[key];
    const assignedWindowId =
      typeof binding === "number" ? binding : binding?.windowId;
    const isHere = assignedWindowId === currentWindow.id;
    const hasAssignment = Boolean(intents[key]);

    card.querySelector(".rule-name").textContent = rule.name;
    card.querySelector(".rule-domains").textContent = rule.domains.join(" · ");

    const status = card.querySelector(".rule-status");
    status.textContent = isHere
      ? "Assigned to this window"
      : assignedWindowId
        ? "Assigned to another window"
        : hasAssignment
          ? "Assigned; waiting to recover its window"
          : "No window assigned yet";
    status.classList.toggle("here", isHere);

    const toggle = card.querySelector(".rule-toggle");
    toggle.checked = rule.enabled;
    toggle.addEventListener("change", async () => {
      try {
        await send({ type: "SET_RULE_ENABLED", ruleId: rule.id, enabled: toggle.checked });
        showNotice(`${rule.name} routing ${toggle.checked ? "enabled" : "disabled"}.`);
      } catch (error) {
        toggle.checked = !toggle.checked;
        showNotice(error.message, true);
      }
    });

    card.querySelector(".assign").addEventListener("click", async () => {
      try {
        await send({
          type: "ASSIGN_WINDOW",
          ruleId: rule.id,
          windowId: currentWindow.id,
          incognito: currentWindow.incognito,
        });
        showNotice(`${rule.name} now routes to this window.`);
        await render();
      } catch (error) {
        showNotice(error.message, true);
      }
    });

    card.querySelector(".collect").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Collecting…";
      try {
        const response = await send({
          type: "COLLECT_TABS",
          ruleId: rule.id,
          windowId: currentWindow.id,
          incognito: currentWindow.incognito,
        });
        showNotice(`Moved ${response.count} ${rule.name} tab${response.count === 1 ? "" : "s"}.`);
        await render();
      } catch (error) {
        showNotice(error.message, true);
      } finally {
        button.disabled = false;
        button.textContent = "Collect tabs here";
      }
    });

    const clearButton = card.querySelector(".clear");
    clearButton.disabled = !hasAssignment;
    clearButton.addEventListener("click", async () => {
      try {
        await send({
          type: "CLEAR_ASSIGNMENT",
          ruleId: rule.id,
          incognito: currentWindow.incognito,
        });
        showNotice(`${rule.name} assignment cleared.`);
        await render();
      } catch (error) {
        showNotice(error.message, true);
      }
    });

    rulesContainer.append(card);
  }
}

document.querySelector("#open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

render().catch((error) => showNotice(error.message, true));
