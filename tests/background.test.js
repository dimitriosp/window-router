import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

function createEvent() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(...args) {
      return listeners.map((listener) => listener(...args));
    },
    listeners,
  };
}

const localData = {};
const sessionData = {};
const tabs = [];
const moves = [];
const createdWindows = [];
const createdMenuItems = [];
const windowMetadata = new Map();
let nextWindowId = 100;
let windowCreateHook = null;

function storageArea(data) {
  return {
    async get(key) {
      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((item) => [item, data[item]]));
      }
      return { [key]: data[key] };
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
  };
}

const events = {
  installed: createEvent(),
  startup: createEvent(),
  message: createEvent(),
  created: createEvent(),
  updated: createEvent(),
  removed: createEvent(),
  alarm: createEvent(),
  contextClicked: createEvent(),
};

globalThis.chrome = {
  storage: {
    local: storageArea(localData),
    session: storageArea(sessionData),
  },
  runtime: {
    onInstalled: events.installed,
    onStartup: events.startup,
    onMessage: events.message,
  },
  alarms: {
    onAlarm: events.alarm,
    async create() {},
  },
  contextMenus: {
    onClicked: events.contextClicked,
    removeAll(callback) {
      createdMenuItems.length = 0;
      callback?.();
    },
    create(properties) {
      createdMenuItems.push(structuredClone(properties));
    },
  },
  tabs: {
    onCreated: events.created,
    onUpdated: events.updated,
    async query() {
      return structuredClone(tabs);
    },
    async get(tabId) {
      const tab = tabs.find((candidate) => candidate.id === tabId);
      if (!tab) throw new Error("Tab not found");
      return structuredClone(tab);
    },
    async move(tabId, { windowId, index }) {
      const tab = tabs.find((candidate) => candidate.id === tabId);
      if (!tab) throw new Error("Tab not found");
      tab.windowId = windowId;
      moves.push({ tabId, windowId, index });
      return structuredClone(tab);
    },
    async update(tabId, changes) {
      const tab = tabs.find((candidate) => candidate.id === tabId);
      Object.assign(tab, changes);
      return structuredClone(tab);
    },
  },
  windows: {
    onRemoved: events.removed,
    async create(properties) {
      const windowId = nextWindowId;
      nextWindowId += 1;
      createdWindows.push({ windowId, ...properties });
      if (properties.tabId) {
        const tab = tabs.find((candidate) => candidate.id === properties.tabId);
        if (!tab) throw new Error("Tab not found");
        tab.windowId = windowId;
      } else if (properties.url) {
        tabs.push({
          id: Math.max(0, ...tabs.map((tab) => tab.id)) + 1,
          windowId,
          incognito: Boolean(properties.incognito),
          url: properties.url,
          active: true,
          pinned: false,
        });
      }
      windowCreateHook?.();
      return { id: windowId, type: "normal", incognito: Boolean(properties.incognito) };
    },
    async get(windowId) {
      return (
        windowMetadata.get(windowId) ?? {
          id: windowId,
          type: "normal",
          incognito: false,
        }
      );
    },
    async update(windowId) {
      return { id: windowId, type: "normal", incognito: false };
    },
  },
};

async function sendMessage(message) {
  return new Promise((resolve) => {
    events.message.listeners[0](message, {}, resolve);
  });
}

async function finishQueuedRouting() {
  await Bun.sleep(10);
}

beforeAll(async () => {
  await import("../src/background.js");
});

beforeEach(() => {
  for (const key of Object.keys(localData)) delete localData[key];
  for (const key of Object.keys(sessionData)) delete sessionData[key];
  tabs.length = 0;
  moves.length = 0;
  createdWindows.length = 0;
  createdMenuItems.length = 0;
  windowMetadata.clear();
  nextWindowId = 100;
  windowCreateHook = null;
});

describe("background routing", () => {
  test("registers the tab context-menu action when installed", async () => {
    events.installed.emit();
    await Bun.sleep(1);

    expect(createdMenuItems).toEqual([
      {
        id: "add-site-to-window-router",
        title: "Add this site to Window Router",
        contexts: ["tab"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
      },
    ]);
  });

  test("does not route before the user assigns a destination", async () => {
    const source = {
      id: 1,
      windowId: 10,
      incognito: false,
      url: "https://youtube.com/watch?v=new",
      active: false,
      pinned: false,
    };
    tabs.push(source, {
      id: 2,
      windowId: 20,
      incognito: false,
      url: "https://youtube.com/watch?v=existing",
      active: false,
      pinned: false,
    });

    events.updated.emit(source.id, { url: source.url }, structuredClone(source));
    await finishQueuedRouting();

    expect(moves).toEqual([]);
  });

  test("organizes one matching tab after its old dedicated window was closed", async () => {
    localData.routingRules = [
      {
        id: "linkedin",
        name: "LinkedIn",
        domains: ["linkedin.com"],
        enabled: true,
      },
    ];
    localData.assignmentIntents = { "linkedin:regular": true };
    localData.organizedRuleWindows = { "linkedin:regular": true };
    const linkedinTab = {
      id: 1,
      windowId: 10,
      incognito: false,
      url: "https://linkedin.com/feed",
      active: true,
      pinned: false,
    };
    tabs.push(linkedinTab);

    events.updated.emit(
      linkedinTab.id,
      { url: linkedinTab.url },
      structuredClone(linkedinTab),
    );
    await finishQueuedRouting();

    expect(sessionData.windowBindings?.["linkedin:regular"]).toBeUndefined();

    const response = await sendMessage({
      type: "ORGANIZE_DOMAINS",
      input: "linkedin.com",
      incognito: false,
    });

    expect(response.created).toBe(1);
    expect(tabs[0].windowId).toBe(100);
  });

  test("does not infer another ordinary window after a destination was closed", async () => {
    localData.routingRules = [
      {
        id: "linkedin",
        name: "LinkedIn",
        domains: ["linkedin.com"],
        enabled: true,
      },
    ];
    localData.assignmentIntents = { "linkedin:regular": true };
    localData.organizedRuleWindows = { "linkedin:regular": true };
    tabs.push(
      {
        id: 1,
        windowId: 20,
        incognito: false,
        url: "https://linkedin.com/in/existing",
        active: false,
        pinned: false,
      },
      {
        id: 2,
        windowId: 10,
        incognito: false,
        url: "https://linkedin.com/feed",
        active: true,
        pinned: false,
      },
    );

    events.updated.emit(2, { url: tabs[1].url }, structuredClone(tabs[1]));
    await finishQueuedRouting();

    expect(tabs.find((tab) => tab.id === 2).windowId).toBe(10);
    expect(sessionData.windowBindings?.["linkedin:regular"]).toBeUndefined();
    expect(createdWindows).toEqual([]);
  });

  test("can automatically create a dedicated window for a listed site", async () => {
    localData.routingRules = [
      {
        id: "linkedin",
        name: "LinkedIn",
        domains: ["linkedin.com"],
        enabled: true,
      },
    ];

    const settingResponse = await sendMessage({
      type: "SET_AUTO_CREATE_WINDOWS",
      enabled: true,
    });
    expect(settingResponse).toEqual({ ok: true, autoCreateWindows: true });
    expect((await sendMessage({ type: "GET_STATE" })).autoCreateWindows).toBe(true);

    const linkedinTab = {
      id: 1,
      windowId: 10,
      incognito: false,
      url: "https://linkedin.com/feed",
      active: true,
      pinned: false,
    };
    tabs.push(linkedinTab);
    events.updated.emit(
      linkedinTab.id,
      { url: linkedinTab.url },
      structuredClone(linkedinTab),
    );
    await finishQueuedRouting();

    expect(createdWindows).toEqual([
      { windowId: 100, tabId: 1, focused: true },
    ]);
    expect(tabs[0].windowId).toBe(100);
    expect(sessionData.windowBindings["linkedin:regular"]).toEqual({
      windowId: 100,
      source: "automatic",
    });

    const futureTab = {
      id: 2,
      windowId: 20,
      incognito: false,
      url: "https://linkedin.com/in/example",
      active: false,
      pinned: false,
    };
    tabs.push(futureTab);
    events.updated.emit(
      futureTab.id,
      { url: futureTab.url },
      structuredClone(futureTab),
    );
    await finishQueuedRouting();

    expect(tabs.find((tab) => tab.id === 2).windowId).toBe(100);
    expect(createdWindows).toHaveLength(1);
  });

  test("automatic mode creates a replacement instead of inferring an ordinary window", async () => {
    localData.routingRules = [
      {
        id: "linkedin",
        name: "LinkedIn",
        domains: ["linkedin.com"],
        enabled: true,
      },
    ];
    await sendMessage({ type: "SET_AUTO_CREATE_WINDOWS", enabled: true });
    tabs.push(
      {
        id: 1,
        windowId: 20,
        incognito: false,
        url: "https://linkedin.com/in/existing",
        active: false,
        pinned: false,
      },
      {
        id: 2,
        windowId: 10,
        incognito: false,
        url: "https://linkedin.com/feed",
        active: true,
        pinned: false,
      },
    );

    events.updated.emit(2, { url: tabs[1].url }, structuredClone(tabs[1]));
    await finishQueuedRouting();

    expect(createdWindows).toEqual([
      { windowId: 100, tabId: 2, focused: true },
    ]);
    expect(tabs.find((tab) => tab.id === 2).windowId).toBe(100);
    expect(tabs.find((tab) => tab.id === 1).windowId).toBe(20);
  });

  test("adopts an existing window after the configured matching-tab threshold", async () => {
    localData.routingRules = [
      {
        id: "x-twitter",
        name: "X / Twitter",
        domains: ["x.com", "twitter.com"],
        enabled: true,
      },
    ];

    const settingResponse = await sendMessage({
      type: "SET_AUTO_MERGE_THRESHOLD",
      threshold: 3,
    });
    expect(settingResponse).toEqual({ ok: true, autoMergeThreshold: 3 });
    await sendMessage({ type: "SET_AUTO_CREATE_WINDOWS", enabled: true });

    tabs.push(
      {
        id: 1,
        windowId: 20,
        incognito: false,
        url: "https://x.com/home",
        active: false,
        pinned: false,
      },
      {
        id: 2,
        windowId: 20,
        incognito: false,
        url: "https://x.com/messages",
        active: false,
        pinned: false,
      },
      {
        id: 3,
        windowId: 20,
        incognito: false,
        url: "https://twitter.com/settings",
        active: false,
        pinned: false,
      },
      {
        id: 4,
        windowId: 10,
        incognito: false,
        url: "https://x.com/explore",
        active: true,
        pinned: false,
      },
    );

    events.updated.emit(4, { url: tabs[3].url }, structuredClone(tabs[3]));
    await finishQueuedRouting();

    expect(tabs.find((tab) => tab.id === 4).windowId).toBe(20);
    expect(sessionData.windowBindings["x-twitter:regular"]).toEqual({
      windowId: 20,
      source: "automatic",
    });
    expect(createdWindows).toEqual([]);
    expect((await sendMessage({ type: "GET_STATE" })).autoMergeThreshold).toBe(3);
  });

  test("does not adopt a window before it reaches the configured threshold", async () => {
    localData.routingRules = [
      {
        id: "x-twitter",
        name: "X / Twitter",
        domains: ["x.com", "twitter.com"],
        enabled: true,
      },
    ];
    await sendMessage({ type: "SET_AUTO_MERGE_THRESHOLD", threshold: 4 });
    tabs.push(
      {
        id: 1,
        windowId: 20,
        incognito: false,
        url: "https://x.com/home",
        active: false,
        pinned: false,
      },
      {
        id: 2,
        windowId: 20,
        incognito: false,
        url: "https://x.com/messages",
        active: false,
        pinned: false,
      },
      {
        id: 3,
        windowId: 20,
        incognito: false,
        url: "https://twitter.com/settings",
        active: false,
        pinned: false,
      },
      {
        id: 4,
        windowId: 10,
        incognito: false,
        url: "https://x.com/explore",
        active: true,
        pinned: false,
      },
    );

    events.updated.emit(4, { url: tabs[3].url }, structuredClone(tabs[3]));
    await finishQueuedRouting();

    expect(tabs.find((tab) => tab.id === 4).windowId).toBe(10);
    expect(sessionData.windowBindings?.["x-twitter:regular"]).toBeUndefined();
    expect(createdWindows).toEqual([]);
  });

  test("ignores non-normal windows when selecting an auto-merge destination", async () => {
    localData.routingRules = [
      {
        id: "x-twitter",
        name: "X / Twitter",
        domains: ["x.com", "twitter.com"],
        enabled: true,
      },
    ];
    await sendMessage({ type: "SET_AUTO_MERGE_THRESHOLD", threshold: 2 });
    windowMetadata.set(20, { id: 20, type: "popup", incognito: false });
    tabs.push(
      ...[1, 2, 3].map((id) => ({
        id,
        windowId: 20,
        incognito: false,
        url: `https://x.com/popup-${id}`,
        active: false,
        pinned: false,
      })),
      ...[4, 5].map((id) => ({
        id,
        windowId: 30,
        incognito: false,
        url: `https://x.com/normal-${id}`,
        active: false,
        pinned: false,
      })),
      {
        id: 6,
        windowId: 10,
        incognito: false,
        url: "https://x.com/explore",
        active: true,
        pinned: false,
      },
    );

    events.updated.emit(6, { url: tabs[5].url }, structuredClone(tabs[5]));
    await finishQueuedRouting();

    expect(tabs.find((tab) => tab.id === 6).windowId).toBe(30);
    expect(sessionData.windowBindings["x-twitter:regular"].windowId).toBe(30);
  });

  test("creates dedicated windows in one action and routes future tabs", async () => {
    tabs.push(
      {
        id: 1,
        windowId: 10,
        incognito: false,
        url: "https://youtube.com/watch?v=one",
        active: false,
        pinned: false,
      },
      {
        id: 2,
        windowId: 20,
        incognito: false,
        url: "https://youtu.be/two",
        active: false,
        pinned: false,
      },
      {
        id: 3,
        windowId: 30,
        incognito: false,
        url: "https://x.com/openai",
        active: false,
        pinned: false,
      },
      {
        id: 4,
        windowId: 40,
        incognito: false,
        url: "https://example.org",
        active: false,
        pinned: false,
      },
    );

    const response = await sendMessage({
      type: "ORGANIZE_DOMAINS",
      input: "youtube.com, x.com, linkedin",
      incognito: false,
    });

    expect(response.ok).toBe(true);
    expect(response.created).toBe(3);
    expect(response.moved).toBe(3);
    expect(createdWindows).toHaveLength(3);
    expect(tabs.find((tab) => tab.id === 1).windowId).toBe(100);
    expect(tabs.find((tab) => tab.id === 2).windowId).toBe(100);
    expect(tabs.find((tab) => tab.id === 3).windowId).toBe(101);
    expect(tabs.find((tab) => tab.id === 4).windowId).toBe(40);
    expect(tabs.some((tab) => tab.windowId === 102 && tab.url === "https://linkedin.com")).toBe(true);

    const futureTab = {
      id: 20,
      windowId: 50,
      incognito: false,
      url: "https://youtube.com/watch?v=future",
      active: false,
      pinned: false,
    };
    tabs.push(futureTab);
    events.updated.emit(
      futureTab.id,
      { url: futureTab.url },
      structuredClone(futureTab),
    );
    await finishQueuedRouting();

    expect(tabs.find((tab) => tab.id === 20).windowId).toBe(100);

    const secondResponse = await sendMessage({
      type: "ORGANIZE_DOMAINS",
      input: "youtube.com, x.com, linkedin",
      incognito: false,
    });
    expect(secondResponse.created).toBe(0);
    expect(createdWindows).toHaveLength(3);
  });

  test("routes matching tabs opened while a large organization is running", async () => {
    tabs.push({
      id: 1,
      windowId: 10,
      incognito: false,
      url: "https://youtube.com/watch?v=existing",
      active: false,
      pinned: false,
    });
    windowCreateHook = () => {
      windowCreateHook = null;
      const newTab = {
        id: 2,
        windowId: 20,
        incognito: false,
        url: "https://youtube.com/watch?v=during",
        active: false,
        pinned: false,
      };
      tabs.push(newTab);
      events.updated.emit(newTab.id, { url: newTab.url }, structuredClone(newTab));
    };

    await sendMessage({
      type: "ORGANIZE_DOMAINS",
      input: "youtube.com",
      incognito: false,
    });
    await finishQueuedRouting();

    expect(tabs.find((tab) => tab.id === 2).windowId).toBe(100);
  });

  test("preserves an advanced multi-domain group", async () => {
    localData.routingRules = [
      {
        id: "notion",
        name: "Notion",
        domains: ["notion.so", "notion.site"],
        enabled: true,
      },
    ];
    tabs.push({
      id: 1,
      windowId: 10,
      incognito: false,
      url: "https://workspace.notion.site/page",
      active: false,
      pinned: false,
    });

    await sendMessage({
      type: "ORGANIZE_DOMAINS",
      input: "notion.so",
      incognito: false,
    });

    expect(localData.routingRules).toEqual([
      {
        id: "notion",
        name: "Notion",
        domains: ["notion.so", "notion.site"],
        enabled: true,
      },
    ]);
    expect(tabs[0].windowId).toBe(100);
  });

  test("saves advanced rules and organizes all enabled rules in one action", async () => {
    tabs.push(
      {
        id: 1,
        windowId: 10,
        incognito: false,
        url: "https://vercel.com/dashboard",
        active: false,
        pinned: false,
      },
      {
        id: 2,
        windowId: 20,
        incognito: false,
        url: "https://example.com/private",
        active: false,
        pinned: false,
      },
    );

    const response = await sendMessage({
      type: "SAVE_AND_ORGANIZE_RULES",
      incognito: false,
      rules: [
        {
          id: "vercel",
          name: "Vercel",
          domains: ["vercel.com"],
          enabled: true,
        },
        {
          id: "example",
          name: "Example",
          domains: ["example.com"],
          enabled: false,
        },
      ],
    });

    expect(response.ok).toBe(true);
    expect(response.created).toBe(1);
    expect(localData.routingRules).toEqual(response.rules);
    expect(tabs.find((tab) => tab.id === 1).windowId).toBe(100);
    expect(tabs.find((tab) => tab.id === 2).windowId).toBe(20);
  });

  test("adds the clicked tab domain and organizes matching tabs", async () => {
    const clickedTab = {
      id: 1,
      windowId: 10,
      incognito: false,
      url: "https://www.facebook.com/groups/example",
      active: true,
      pinned: false,
    };
    tabs.push(
      clickedTab,
      {
        id: 2,
        windowId: 20,
        incognito: false,
        url: "https://m.facebook.com/messages",
        active: false,
        pinned: false,
      },
      {
        id: 3,
        windowId: 30,
        incognito: false,
        url: "https://example.org",
        active: false,
        pinned: false,
      },
    );

    const [contextAction] = events.contextClicked.emit(
      { menuItemId: "add-site-to-window-router" },
      structuredClone(clickedTab),
    );
    await contextAction;

    expect(localData.routingRules.some((rule) => rule.domains.includes("facebook.com"))).toBe(true);
    expect(createdWindows).toHaveLength(1);
    expect(tabs.find((tab) => tab.id === 1).windowId).toBe(100);
    expect(tabs.find((tab) => tab.id === 2).windowId).toBe(100);
    expect(tabs.find((tab) => tab.id === 3).windowId).toBe(30);

    const futureTab = {
      id: 4,
      windowId: 40,
      incognito: false,
      url: "https://facebook.com/events/future",
      active: false,
      pinned: false,
    };
    tabs.push(futureTab);
    events.updated.emit(
      futureTab.id,
      { url: futureTab.url },
      structuredClone(futureTab),
    );
    await finishQueuedRouting();

    expect(tabs.find((tab) => tab.id === 4).windowId).toBe(100);
  });

  test("does not add an internal Chrome tab from the context menu", async () => {
    const clickedTab = {
      id: 1,
      windowId: 10,
      incognito: false,
      url: "chrome://extensions",
      active: true,
      pinned: false,
    };
    tabs.push(clickedTab);

    const [contextAction] = events.contextClicked.emit(
      { menuItemId: "add-site-to-window-router" },
      structuredClone(clickedTab),
    );
    await contextAction;

    expect(localData.routingRules).toBeUndefined();
    expect(createdWindows).toEqual([]);
  });

  test("queues repeated context-menu actions instead of dropping them", async () => {
    const facebookTab = {
      id: 1,
      windowId: 10,
      incognito: false,
      url: "https://facebook.com/home",
      active: false,
      pinned: false,
    };
    const githubTab = {
      id: 2,
      windowId: 20,
      incognito: false,
      url: "https://github.com/openai",
      active: false,
      pinned: false,
    };
    tabs.push(facebookTab, githubTab);

    const [facebookAction] = events.contextClicked.emit(
      { menuItemId: "add-site-to-window-router" },
      structuredClone(facebookTab),
    );
    const [githubAction] = events.contextClicked.emit(
      { menuItemId: "add-site-to-window-router" },
      structuredClone(githubTab),
    );
    await Promise.all([facebookAction, githubAction]);

    expect(createdWindows).toHaveLength(2);
    expect(tabs.find((tab) => tab.id === 1).windowId).toBe(100);
    expect(tabs.find((tab) => tab.id === 2).windowId).toBe(101);
  });

  test("waits for restored tabs to settle before recovering a window", async () => {
    const restoredTab = {
      id: 1,
      windowId: 10,
      incognito: false,
      url: "https://youtube.com/watch?v=one",
      active: false,
      pinned: false,
    };
    tabs.push(restoredTab);
    localData.assignmentIntents = { "youtube:regular": true };

    events.startup.emit();
    await Bun.sleep(1);
    events.updated.emit(
      restoredTab.id,
      { url: restoredTab.url },
      structuredClone(restoredTab),
    );
    await finishQueuedRouting();

    expect(moves).toEqual([]);

    tabs.push({
      id: 2,
      windowId: 20,
      incognito: false,
      url: "https://youtube.com/watch?v=two",
      active: false,
      pinned: false,
    });
    tabs.push({
      id: 3,
      windowId: 20,
      incognito: false,
      url: "https://youtube.com/watch?v=three",
      active: false,
      pinned: false,
    });
    events.alarm.emit({ name: "finish-startup-recovery" });
    await Bun.sleep(20);

    expect(sessionData.windowBindings["youtube:regular"].windowId).toBe(20);
    expect(sessionData.startupRecoveryPending).toBe(false);
    expect(moves).toEqual([{ tabId: 1, windowId: 20, index: -1 }]);
  });
});
