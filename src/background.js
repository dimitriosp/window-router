import {
  DEFAULT_RULES,
  bindingKey,
  sanitizeRules,
  selectDestinationWindow,
  urlMatchesDomains,
  urlMatchesRule,
} from "./router-core.js";

const RULES_KEY = "routingRules";
const BINDINGS_KEY = "windowBindings";
const ASSIGNMENT_INTENTS_KEY = "assignmentIntents";
const movingTabs = new Set();
let routingQueue = Promise.resolve();

async function getRules() {
  const stored = await chrome.storage.local.get(RULES_KEY);
  const rules = sanitizeRules(stored[RULES_KEY]);
  if (rules.length > 0) return rules;

  const defaults = DEFAULT_RULES.map((rule) => ({ ...rule, domains: [...rule.domains] }));
  await chrome.storage.local.set({ [RULES_KEY]: defaults });
  return defaults;
}

async function getBindings() {
  const stored = await chrome.storage.session.get(BINDINGS_KEY);
  return stored[BINDINGS_KEY] ?? {};
}

async function saveBindings(bindings) {
  await chrome.storage.session.set({ [BINDINGS_KEY]: bindings });
}

async function getAssignmentIntents() {
  const stored = await chrome.storage.local.get(ASSIGNMENT_INTENTS_KEY);
  return stored[ASSIGNMENT_INTENTS_KEY] ?? {};
}

async function saveAssignmentIntents(intents) {
  await chrome.storage.local.set({ [ASSIGNMENT_INTENTS_KEY]: intents });
}

async function isUsableWindow(windowId, incognito) {
  if (!Number.isInteger(windowId)) return false;
  try {
    const window = await chrome.windows.get(windowId);
    return window.type === "normal" && window.incognito === Boolean(incognito);
  } catch {
    return false;
  }
}

async function setBinding(ruleId, incognito, windowId, source = "manual") {
  const bindings = await getBindings();
  bindings[bindingKey(ruleId, incognito)] = { windowId, source };
  await saveBindings(bindings);
}

async function clearBinding(ruleId, incognito) {
  const bindings = await getBindings();
  delete bindings[bindingKey(ruleId, incognito)];
  await saveBindings(bindings);
}

async function findDestination(rule, sourceTab) {
  const key = bindingKey(rule.id, sourceTab.incognito);
  const [bindings, intents] = await Promise.all([getBindings(), getAssignmentIntents()]);
  if (!intents[key]) return null;

  const binding = bindings[key];
  const assignedWindowId =
    typeof binding === "number" ? binding : binding?.windowId;
  const bindingSource = typeof binding === "number" ? "manual" : binding?.source;

  if (
    bindingSource === "manual" &&
    (await isUsableWindow(assignedWindowId, sourceTab.incognito))
  ) {
    return assignedWindowId;
  }

  const tabs = await chrome.tabs.query({});
  const recoveredWindowId = selectDestinationWindow(
    tabs,
    rule,
    sourceTab.windowId,
    sourceTab.incognito,
  );
  if (recoveredWindowId !== null) {
    bindings[key] = { windowId: recoveredWindowId, source: "recovered" };
    await saveBindings(bindings);
  }
  return recoveredWindowId;
}

async function moveTabToWindow(tab, targetWindowId) {
  const movedTab = await chrome.tabs.move(tab.id, {
    windowId: targetWindowId,
    index: tab.pinned ? 0 : -1,
  });
  if (tab.pinned && !movedTab.pinned) {
    await chrome.tabs.update(tab.id, { pinned: true });
  }
}

async function routeTab(tab) {
  if (!tab?.id || !tab.url || movingTabs.has(tab.id)) return;

  const rules = await getRules();
  const rule = rules.find((candidate) => urlMatchesRule(tab.url, candidate));
  if (!rule) return;

  const targetWindowId = await findDestination(rule, tab);
  if (targetWindowId === null || targetWindowId === tab.windowId) return;

  movingTabs.add(tab.id);
  try {
    await moveTabToWindow(tab, targetWindowId);
    if (tab.active) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(targetWindowId, { focused: true });
    }
  } catch (error) {
    await clearBinding(rule.id, tab.incognito);
    console.warn("Window Router could not move a tab.", error);
  } finally {
    movingTabs.delete(tab.id);
  }
}

function queueRoute(tab) {
  routingQueue = routingQueue.then(() => routeTab(tab)).catch((error) => {
    console.warn("Window Router routing failed.", error);
  });
}

async function collectTabs(rule, targetWindowId, incognito) {
  if (!(await isUsableWindow(targetWindowId, incognito))) {
    throw new Error("The selected Chrome window is no longer available.");
  }

  const tabs = await chrome.tabs.query({});
  const matchingTabs = tabs.filter(
    (tab) =>
      tab.windowId !== targetWindowId &&
      tab.incognito === Boolean(incognito) &&
      urlMatchesDomains(tab.url, rule.domains),
  );

  for (const tab of matchingTabs) {
    movingTabs.add(tab.id);
    try {
      await moveTabToWindow(tab, targetWindowId);
    } finally {
      movingTabs.delete(tab.id);
    }
  }

  return matchingTabs.length;
}

chrome.runtime.onInstalled.addListener(() => {
  void getRules();
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.url) queueRoute(tab);
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url) queueRoute(tab);
});

chrome.windows.onRemoved.addListener((windowId) => {
  void getBindings().then((bindings) => {
    let changed = false;
    for (const key of Object.keys(bindings)) {
      const binding = bindings[key];
      const assignedWindowId =
        typeof binding === "number" ? binding : binding?.windowId;
      if (assignedWindowId === windowId) {
        delete bindings[key];
        changed = true;
      }
    }
    if (changed) return saveBindings(bindings);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    const rules = await getRules();

    if (message.type === "GET_STATE") {
      const [bindings, intents] = await Promise.all([
        getBindings(),
        getAssignmentIntents(),
      ]);
      sendResponse({ ok: true, rules, bindings, intents });
      return;
    }

    const rule = rules.find((candidate) => candidate.id === message.ruleId);
    if (!rule && message.type !== "SAVE_RULES") {
      throw new Error("Routing rule not found.");
    }

    if (message.type === "ASSIGN_WINDOW") {
      if (!(await isUsableWindow(message.windowId, message.incognito))) {
        throw new Error("The selected Chrome window is no longer available.");
      }
      await setBinding(rule.id, message.incognito, message.windowId);
      const intents = await getAssignmentIntents();
      intents[bindingKey(rule.id, message.incognito)] = true;
      await saveAssignmentIntents(intents);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CLEAR_ASSIGNMENT") {
      await clearBinding(rule.id, message.incognito);
      const intents = await getAssignmentIntents();
      delete intents[bindingKey(rule.id, message.incognito)];
      await saveAssignmentIntents(intents);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "SET_RULE_ENABLED") {
      const updatedRules = rules.map((candidate) =>
        candidate.id === rule.id
          ? { ...candidate, enabled: Boolean(message.enabled) }
          : candidate,
      );
      await chrome.storage.local.set({ [RULES_KEY]: updatedRules });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "COLLECT_TABS") {
      await setBinding(rule.id, message.incognito, message.windowId);
      const intents = await getAssignmentIntents();
      intents[bindingKey(rule.id, message.incognito)] = true;
      await saveAssignmentIntents(intents);
      const count = await collectTabs(rule, message.windowId, message.incognito);
      sendResponse({ ok: true, count });
      return;
    }

    if (message.type === "SAVE_RULES") {
      const updatedRules = sanitizeRules(message.rules);
      if (updatedRules.length === 0) throw new Error("Add at least one valid rule.");
      await chrome.storage.local.set({ [RULES_KEY]: updatedRules });

      const allowedRuleIds = new Set(updatedRules.map((candidate) => candidate.id));
      const [bindings, intents] = await Promise.all([
        getBindings(),
        getAssignmentIntents(),
      ]);
      for (const key of Object.keys(bindings)) {
        const ruleId = key.replace(/:(regular|incognito)$/, "");
        if (!allowedRuleIds.has(ruleId)) delete bindings[key];
      }
      for (const key of Object.keys(intents)) {
        const ruleId = key.replace(/:(regular|incognito)$/, "");
        if (!allowedRuleIds.has(ruleId)) delete intents[key];
      }
      await saveBindings(bindings);
      await saveAssignmentIntents(intents);
      sendResponse({ ok: true, rules: updatedRules });
      return;
    }

    throw new Error("Unknown request.");
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});
