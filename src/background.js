import {
  DEFAULT_RULES,
  bindingKey,
  bindingWindowId,
  parseDomainRules,
  sanitizeRules,
  selectDestinationWindow,
  urlMatchesDomains,
  urlMatchesRule,
} from "./router-core.js";

const RULES_KEY = "routingRules";
const BINDINGS_KEY = "windowBindings";
const ASSIGNMENT_INTENTS_KEY = "assignmentIntents";
const STARTUP_RECOVERY_KEY = "startupRecoveryPending";
const DEFERRED_TABS_KEY = "startupDeferredTabIds";
const ORGANIZED_RULES_KEY = "organizedRuleWindows";
const AUTO_CREATE_WINDOWS_KEY = "autoCreateWindows";
const STARTUP_RECOVERY_ALARM = "finish-startup-recovery";
const ADD_SITE_MENU_ID = "add-site-to-window-router";
const movingTabs = new Set();
let workQueue = Promise.resolve();
let startupRecoveryPending = false;

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

async function getOrganizedRules() {
  const stored = await chrome.storage.local.get(ORGANIZED_RULES_KEY);
  return stored[ORGANIZED_RULES_KEY] ?? {};
}

async function getAutoCreateWindows() {
  const stored = await chrome.storage.local.get(AUTO_CREATE_WINDOWS_KEY);
  return Boolean(stored[AUTO_CREATE_WINDOWS_KEY]);
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

async function loadAssignmentState() {
  const [bindings, intents, organizedRules] = await Promise.all([
    getBindings(),
    getAssignmentIntents(),
    getOrganizedRules(),
  ]);
  return { bindings, intents, organizedRules };
}

async function saveAssignmentState({ bindings, intents, organizedRules }) {
  await Promise.all([
    saveBindings(bindings),
    saveAssignmentIntents(intents),
    chrome.storage.local.set({ [ORGANIZED_RULES_KEY]: organizedRules }),
  ]);
}

async function deferForStartupRecovery(tabId) {
  if (!startupRecoveryPending) {
    const stored = await chrome.storage.session.get(STARTUP_RECOVERY_KEY);
    startupRecoveryPending = Boolean(stored[STARTUP_RECOVERY_KEY]);
  }
  if (!startupRecoveryPending) return false;

  const stored = await chrome.storage.session.get(DEFERRED_TABS_KEY);
  const deferredTabIds = new Set(stored[DEFERRED_TABS_KEY] ?? []);
  deferredTabIds.add(tabId);
  await chrome.storage.session.set({
    [DEFERRED_TABS_KEY]: [...deferredTabIds],
  });
  await chrome.alarms.create(STARTUP_RECOVERY_ALARM, {
    when: Date.now() + 1000,
  });
  return true;
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
  const assignedWindowId = bindingWindowId(binding);
  const bindingSource = typeof binding === "number" ? "manual" : binding?.source;

  if (
    (bindingSource === "manual" ||
      bindingSource === "automatic" ||
      bindingSource === "recovered") &&
    (await isUsableWindow(assignedWindowId, sourceTab.incognito))
  ) {
    return assignedWindowId;
  }

  if (binding) {
    delete bindings[key];
    await saveBindings(bindings);
  }
  return null;
}

async function createAutomaticDestination(rule, tab) {
  const key = bindingKey(rule.id, tab.incognito);
  movingTabs.add(tab.id);
  try {
    const createdWindow = await chrome.windows.create({
      tabId: tab.id,
      focused: Boolean(tab.active),
    });
    const assignmentState = await loadAssignmentState();
    assignmentState.bindings[key] = {
      windowId: createdWindow.id,
      source: "automatic",
    };
    assignmentState.intents[key] = true;
    assignmentState.organizedRules[key] = true;
    await saveAssignmentState(assignmentState);
  } finally {
    movingTabs.delete(tab.id);
  }
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
  if (await deferForStartupRecovery(tab.id)) return;

  const [rules, autoCreateWindows] = await Promise.all([
    getRules(),
    getAutoCreateWindows(),
  ]);
  const rule = rules.find((candidate) => urlMatchesRule(tab.url, candidate));
  if (!rule) return;

  const targetWindowId = await findDestination(rule, tab);
  if (targetWindowId === null) {
    if (autoCreateWindows) await createAutomaticDestination(rule, tab);
    return;
  }
  if (targetWindowId === tab.windowId) return;

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
  void enqueueWork(() => routeTab(tab)).catch((error) => {
    console.warn("Window Router routing failed.", error);
  });
}

function enqueueWork(task) {
  const result = workQueue.then(task);
  workQueue = result.catch(() => {});
  return result;
}

async function moveMatchingTabs(tabs, targetWindowId) {
  let moved = 0;
  let failed = 0;
  for (const tab of tabs) {
    if (tab.windowId === targetWindowId) continue;
    movingTabs.add(tab.id);
    try {
      await moveTabToWindow(tab, targetWindowId);
      moved += 1;
    } catch (error) {
      failed += 1;
      console.warn("Window Router could not organize a tab.", error);
    } finally {
      movingTabs.delete(tab.id);
    }
  }
  return { moved, failed };
}

async function saveRuleSet(updatedRules) {
  await chrome.storage.local.set({ [RULES_KEY]: updatedRules });

  const allowedRuleIds = new Set(updatedRules.map((candidate) => candidate.id));
  const assignmentState = await loadAssignmentState();
  const { bindings, intents, organizedRules } = assignmentState;
  for (const collection of [bindings, intents, organizedRules]) {
    for (const key of Object.keys(collection)) {
      const ruleId = key.replace(/:(regular|incognito)$/, "");
      if (!allowedRuleIds.has(ruleId)) delete collection[key];
    }
  }

  await saveAssignmentState(assignmentState);
}

function preserveExistingDomainGroups(parsedRules, existingRules) {
  const usedRuleIds = new Set();
  return parsedRules.flatMap((parsedRule) => {
    const existingRule = existingRules.find((candidate) =>
      parsedRule.domains.some((domain) => candidate.domains.includes(domain)),
    );
    const rule = existingRule
      ? { ...existingRule, domains: [...existingRule.domains], enabled: true }
      : parsedRule;
    if (usedRuleIds.has(rule.id)) return [];
    usedRuleIds.add(rule.id);
    return [rule];
  });
}

async function organizeRule(
  rule,
  incognito,
  tabs,
  assignmentState,
  claimedTabIds = new Set(),
  preferredTabId = null,
) {
  const { bindings, intents, organizedRules } = assignmentState;
  const key = bindingKey(rule.id, incognito);
  const matchingTabs = tabs.filter(
    (tab) =>
      tab.incognito === Boolean(incognito) &&
      !claimedTabIds.has(tab.id) &&
      urlMatchesDomains(tab.url, rule.domains),
  );
  matchingTabs.forEach((tab) => claimedTabIds.add(tab.id));

  const preferredTabIndex = matchingTabs.findIndex(
    (tab) => tab.id === preferredTabId,
  );
  if (preferredTabIndex > 0) {
    matchingTabs.unshift(matchingTabs.splice(preferredTabIndex, 1)[0]);
  }

  const savedWindowId = organizedRules[key]
    ? bindingWindowId(bindings[key])
    : null;
  const canReuseWindow = await isUsableWindow(savedWindowId, incognito);
  let targetWindowId = savedWindowId;
  let created = false;
  let moved = 0;
  let failed = 0;

  if (!canReuseWindow) {
    created = true;
    if (matchingTabs.length > 0) {
      const firstTab = matchingTabs.shift();
      const sourceWindowId = firstTab.windowId;
      movingTabs.add(firstTab.id);
      try {
        const createdWindow = await chrome.windows.create({
          tabId: firstTab.id,
          focused: false,
        });
        targetWindowId = createdWindow.id;
        if (sourceWindowId !== targetWindowId) moved += 1;
      } finally {
        movingTabs.delete(firstTab.id);
      }
    } else {
      const createdWindow = await chrome.windows.create({
        url: `https://${rule.domains[0]}`,
        incognito: Boolean(incognito),
        focused: false,
      });
      targetWindowId = createdWindow.id;
    }
  }

  bindings[key] = { windowId: targetWindowId, source: "manual" };
  intents[key] = true;
  organizedRules[key] = true;
  await saveAssignmentState(assignmentState);

  const moveResult = await moveMatchingTabs(matchingTabs, targetWindowId);
  moved += moveResult.moved;
  failed += moveResult.failed;
  return {
    ruleId: rule.id,
    name: rule.name,
    domain: rule.domains[0],
    windowId: targetWindowId,
    created,
    moved,
    failed,
  };
}

async function organizeDomains(input, incognito) {
  const parsedRules = parseDomainRules(input);
  if (parsedRules.length === 0) {
    throw new Error("Enter at least one valid website, such as youtube.com.");
  }

  const rules = preserveExistingDomainGroups(parsedRules, await getRules());
  return organizeRuleSet(rules, incognito);
}

async function organizeRuleSet(rules, incognito) {
  await saveRuleSet(rules);
  const [tabs, assignmentState] = await Promise.all([
    chrome.tabs.query({}),
    loadAssignmentState(),
  ]);
  const claimedTabIds = new Set();
  const results = [];

  for (const rule of rules.filter((candidate) => candidate.enabled)) {
    results.push(
      await organizeRule(
        rule,
        incognito,
        tabs,
        assignmentState,
        claimedTabIds,
      ),
    );
  }

  return {
    rules,
    results,
    moved: results.reduce((total, result) => total + result.moved, 0),
    failed: results.reduce((total, result) => total + result.failed, 0),
    created: results.filter((result) => result.created).length,
  };
}

async function saveAndOrganizeRules(inputRules, incognito) {
  const rules = sanitizeRules(inputRules);
  if (rules.length === 0) throw new Error("Add at least one valid rule.");
  return organizeRuleSet(rules, incognito);
}

async function addTabSiteToRouter(tab) {
  if (!tab?.id || !tab.url) return;

  let parsedUrl;
  try {
    parsedUrl = new URL(tab.url);
  } catch {
    return;
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return;

  const [parsedRule] = parseDomainRules(parsedUrl.origin);
  if (!parsedRule) return;

  const existingRules = await getRules();
  const existingRule = existingRules.find((candidate) =>
    urlMatchesDomains(tab.url, candidate.domains),
  );
  const rule = existingRule
    ? { ...existingRule, domains: [...existingRule.domains], enabled: true }
    : parsedRule;
  const rules = existingRule
    ? existingRules.map((candidate) =>
        candidate.id === rule.id ? rule : candidate,
      )
    : [...existingRules, rule];

  await saveRuleSet(rules);
  const [tabs, assignmentState] = await Promise.all([
    chrome.tabs.query({}),
    loadAssignmentState(),
  ]);
  const result = await organizeRule(
    rule,
    tab.incognito,
    tabs,
    assignmentState,
    new Set(),
    tab.id,
  );

  if (tab.active) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(result.windowId, { focused: true });
  }
}

function registerContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: ADD_SITE_MENU_ID,
      title: "Add this site to Window Router",
      contexts: ["tab"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
  });
}

async function finishStartupRecovery() {
  const recoveryState = await chrome.storage.session.get([
    STARTUP_RECOVERY_KEY,
    DEFERRED_TABS_KEY,
  ]);
  if (!recoveryState[STARTUP_RECOVERY_KEY]) return;

  const [rules, tabs, intents, bindings] = await Promise.all([
    getRules(),
    chrome.tabs.query({}),
    getAssignmentIntents(),
    getBindings(),
  ]);

  for (const rule of rules.filter((candidate) => candidate.enabled)) {
    for (const incognito of [false, true]) {
      const key = bindingKey(rule.id, incognito);
      if (!intents[key]) continue;
      const existingBinding = bindings[key];
      if (existingBinding?.source === "manual") continue;

      const destination = selectDestinationWindow(tabs, rule, null, incognito);
      if (destination !== null) {
        bindings[key] = { windowId: destination, source: "recovered" };
      }
    }
  }

  await saveBindings(bindings);
  startupRecoveryPending = false;
  await chrome.storage.session.set({
    [STARTUP_RECOVERY_KEY]: false,
    [DEFERRED_TABS_KEY]: [],
  });

  for (const tabId of recoveryState[DEFERRED_TABS_KEY] ?? []) {
    try {
      await routeTab(await chrome.tabs.get(tabId));
    } catch {
      // A deferred tab can close before startup recovery finishes.
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void enqueueWork(() => getRules()).catch((error) => {
    console.warn("Window Router could not initialize its rules.", error);
  });
  registerContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== ADD_SITE_MENU_ID) return;
  return enqueueWork(() => addTabSiteToRouter(tab)).catch((error) => {
    console.warn("Window Router could not add this site.", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  void enqueueWork(async () => {
    startupRecoveryPending = true;
    await chrome.storage.session.set({
      [STARTUP_RECOVERY_KEY]: true,
      [DEFERRED_TABS_KEY]: [],
    });
    await chrome.alarms.create(STARTUP_RECOVERY_ALARM, {
        when: Date.now() + 1000,
    });
  }).catch((error) => {
    console.warn("Window Router startup preparation failed.", error);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === STARTUP_RECOVERY_ALARM) {
    void enqueueWork(finishStartupRecovery).catch((error) => {
      console.warn("Window Router startup recovery failed.", error);
    });
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.url) queueRoute(tab);
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url) queueRoute(tab);
});

chrome.windows.onRemoved.addListener((windowId) => {
  void enqueueWork(async () => {
    const bindings = await getBindings();
    let changed = false;
    for (const key of Object.keys(bindings)) {
      const binding = bindings[key];
      const assignedWindowId = bindingWindowId(binding);
      if (assignedWindowId === windowId) {
        delete bindings[key];
        changed = true;
      }
    }
    if (changed) await saveBindings(bindings);
  }).catch((error) => {
    console.warn("Window Router could not clear a closed window.", error);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void enqueueWork(async () => {
    const rules = await getRules();

    if (message.type === "GET_STATE") {
      const [bindings, intents, autoCreateWindows] = await Promise.all([
        getBindings(),
        getAssignmentIntents(),
        getAutoCreateWindows(),
      ]);
      sendResponse({ ok: true, rules, bindings, intents, autoCreateWindows });
      return;
    }

    if (message.type === "SET_AUTO_CREATE_WINDOWS") {
      const autoCreateWindows = Boolean(message.enabled);
      await chrome.storage.local.set({ [AUTO_CREATE_WINDOWS_KEY]: autoCreateWindows });
      sendResponse({ ok: true, autoCreateWindows });
      return;
    }

    if (message.type === "ORGANIZE_DOMAINS") {
      const result = await organizeDomains(message.input, message.incognito);
      sendResponse({ ok: true, ...result });
      return;
    }

    if (message.type === "SAVE_AND_ORGANIZE_RULES") {
      const result = await saveAndOrganizeRules(message.rules, message.incognito);
      sendResponse({ ok: true, ...result });
      return;
    }

    const rule = rules.find((candidate) => candidate.id === message.ruleId);
    if (!rule && message.type !== "SAVE_RULES") {
      throw new Error("Routing rule not found.");
    }

    if (message.type === "CLEAR_ASSIGNMENT") {
      await clearBinding(rule.id, message.incognito);
      const intents = await getAssignmentIntents();
      delete intents[bindingKey(rule.id, message.incognito)];
      await saveAssignmentIntents(intents);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "SAVE_RULES") {
      const updatedRules = sanitizeRules(message.rules);
      if (updatedRules.length === 0) throw new Error("Add at least one valid rule.");
      await saveRuleSet(updatedRules);
      sendResponse({ ok: true, rules: updatedRules });
      return;
    }

    throw new Error("Unknown request.");
  }).catch((error) => {
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});
