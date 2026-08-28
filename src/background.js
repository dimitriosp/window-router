import {
  DEFAULT_RULES,
  bindingKey,
  sanitizeRules,
  selectDestinationWindow,
  urlMatchesRule,
} from "./router-core.js";

const RULES_KEY = "routingRules";
const BINDINGS_KEY = "windowBindings";
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

async function isUsableWindow(windowId, incognito) {
  if (!Number.isInteger(windowId)) return false;
  try {
    const window = await chrome.windows.get(windowId);
    return window.type === "normal" && window.incognito === Boolean(incognito);
  } catch {
    return false;
  }
}

async function setBinding(ruleId, incognito, windowId) {
  const bindings = await getBindings();
  bindings[bindingKey(ruleId, incognito)] = windowId;
  await saveBindings(bindings);
}

async function clearBinding(ruleId, incognito) {
  const bindings = await getBindings();
  delete bindings[bindingKey(ruleId, incognito)];
  await saveBindings(bindings);
}

async function findDestination(rule, sourceTab) {
  const key = bindingKey(rule.id, sourceTab.incognito);
  const bindings = await getBindings();
  const assignedWindowId = bindings[key];

  if (await isUsableWindow(assignedWindowId, sourceTab.incognito)) {
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
    bindings[key] = recoveredWindowId;
    await saveBindings(bindings);
  }
  return recoveredWindowId;
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
    const movedTab = await chrome.tabs.move(tab.id, {
      windowId: targetWindowId,
      index: tab.pinned ? 0 : -1,
    });
    if (tab.pinned && !movedTab.pinned) {
      await chrome.tabs.update(tab.id, { pinned: true });
    }
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

async function rebuildBindings() {
  const [rules, tabs] = await Promise.all([getRules(), chrome.tabs.query({})]);
  const bindings = {};

  for (const rule of rules.filter((candidate) => candidate.enabled)) {
    for (const incognito of [false, true]) {
      const destination = selectDestinationWindow(tabs, rule, null, incognito);
      if (destination !== null) bindings[bindingKey(rule.id, incognito)] = destination;
    }
  }

  await saveBindings(bindings);
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
      urlMatchesRule(tab.url, rule),
  );

  for (const tab of matchingTabs) {
    movingTabs.add(tab.id);
    try {
      const movedTab = await chrome.tabs.move(tab.id, {
        windowId: targetWindowId,
        index: tab.pinned ? 0 : -1,
      });
      if (tab.pinned && !movedTab.pinned) {
        await chrome.tabs.update(tab.id, { pinned: true });
      }
    } finally {
      movingTabs.delete(tab.id);
    }
  }

  return matchingTabs.length;
}

chrome.runtime.onInstalled.addListener(() => {
  void getRules().then(rebuildBindings);
});

chrome.runtime.onStartup.addListener(() => {
  void rebuildBindings();
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
      if (bindings[key] === windowId) {
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
      const bindings = await getBindings();
      sendResponse({ ok: true, rules, bindings });
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
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CLEAR_ASSIGNMENT") {
      await clearBinding(rule.id, message.incognito);
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
      const count = await collectTabs(rule, message.windowId, message.incognito);
      sendResponse({ ok: true, count });
      return;
    }

    if (message.type === "SAVE_RULES") {
      const updatedRules = sanitizeRules(message.rules);
      if (updatedRules.length === 0) throw new Error("Add at least one valid rule.");
      await chrome.storage.local.set({ [RULES_KEY]: updatedRules });

      const allowedRuleIds = new Set(updatedRules.map((candidate) => candidate.id));
      const bindings = await getBindings();
      for (const key of Object.keys(bindings)) {
        const ruleId = key.replace(/:(regular|incognito)$/, "");
        if (!allowedRuleIds.has(ruleId)) delete bindings[key];
      }
      await saveBindings(bindings);
      sendResponse({ ok: true, rules: updatedRules });
      return;
    }

    throw new Error("Unknown request.");
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});
