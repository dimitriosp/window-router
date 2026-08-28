const domainInput = document.querySelector("#domains");
const organizeButton = document.querySelector("#organize");
const autoCreateToggle = document.querySelector("#auto-create-windows");
const autoMergeSelect = document.querySelector("#auto-merge-threshold");
const notice = document.querySelector("#notice");
const resultsSection = document.querySelector("#results");
const resultList = document.querySelector("#result-list");

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("error", isError);
  notice.hidden = false;
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error ?? "The extension did not respond.");
  return response;
}

async function loadState() {
  try {
    const { rules, autoCreateWindows, autoMergeThreshold } = await send({
      type: "GET_STATE",
    });
    domainInput.value = rules.map((rule) => rule.domains[0]).join("\n");
    autoCreateToggle.checked = autoCreateWindows;
    autoMergeSelect.value = String(autoMergeThreshold);
    autoMergeSelect.dataset.savedValue = autoMergeSelect.value;
  } finally {
    autoCreateToggle.disabled = false;
    autoMergeSelect.disabled = false;
  }
}

function renderResults(response) {
  resultList.replaceChildren();
  for (const result of response.results) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const detail = document.createElement("span");
    name.textContent = result.name;
    detail.textContent = result.created
      ? `New window · ${result.moved} moved${result.failed ? ` · ${result.failed} failed` : ""}`
      : `Existing window · ${result.moved} moved${result.failed ? ` · ${result.failed} failed` : ""}`;
    item.append(name, detail);
    resultList.append(item);
  }
  resultsSection.hidden = false;
}

organizeButton.addEventListener("click", async () => {
  organizeButton.disabled = true;
  organizeButton.textContent = "Organizing your tabs…";
  notice.hidden = true;
  resultsSection.hidden = true;

  try {
    const currentWindow = await chrome.windows.getCurrent();
    const response = await send({
      type: "ORGANIZE_DOMAINS",
      input: domainInput.value,
      incognito: currentWindow.incognito,
    });
    renderResults(response);
    const summary = `Done. ${response.created} window${response.created === 1 ? "" : "s"} created and ${response.moved} tab${response.moved === 1 ? "" : "s"} moved.`;
    showNotice(
      response.failed
        ? `${summary} ${response.failed} tab${response.failed === 1 ? "" : "s"} could not be moved; press the button again to retry.`
        : summary,
      response.failed > 0,
    );
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    organizeButton.disabled = false;
    organizeButton.textContent = "Organize all open tabs";
  }
});

autoCreateToggle.addEventListener("change", async () => {
  const enabled = autoCreateToggle.checked;
  autoCreateToggle.disabled = true;
  try {
    const response = await send({ type: "SET_AUTO_CREATE_WINDOWS", enabled });
    autoCreateToggle.checked = response.autoCreateWindows;
    showNotice(
      enabled
        ? "Automatic window creation is on for listed sites."
        : "Automatic window creation is off.",
    );
  } catch (error) {
    autoCreateToggle.checked = !enabled;
    showNotice(error.message, true);
  } finally {
    autoCreateToggle.disabled = false;
  }
});

autoMergeSelect.addEventListener("change", async () => {
  const previousValue = autoMergeSelect.dataset.savedValue ?? "0";
  const threshold = Number(autoMergeSelect.value);
  autoMergeSelect.disabled = true;
  try {
    const response = await send({
      type: "SET_AUTO_MERGE_THRESHOLD",
      threshold,
    });
    autoMergeSelect.value = String(response.autoMergeThreshold);
    autoMergeSelect.dataset.savedValue = autoMergeSelect.value;
    showNotice(
      response.autoMergeThreshold === 0
        ? "Automatic merging is off."
        : `A matching window will be adopted after ${response.autoMergeThreshold} tab${response.autoMergeThreshold === 1 ? "" : "s"}.`,
    );
  } catch (error) {
    autoMergeSelect.value = previousValue;
    showNotice(error.message, true);
  } finally {
    autoMergeSelect.disabled = false;
  }
});

document.querySelector("#open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

loadState().catch((error) => showNotice(error.message, true));
