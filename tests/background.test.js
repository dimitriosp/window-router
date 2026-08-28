import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

function createEvent() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(...args) {
      for (const listener of listeners) listener(...args);
    },
    listeners,
  };
}

const localData = {};
const sessionData = {};
const tabs = [];
const moves = [];
const createdWindows = [];
let nextWindowId = 100;

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
      return { id: windowId, type: "normal", incognito: Boolean(properties.incognito) };
    },
    async get(windowId) {
      return { id: windowId, type: "normal", incognito: false };
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
  nextWindowId = 100;
});

describe("background routing", () => {
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

  test("routes to a window after explicit assignment", async () => {
    const source = {
      id: 1,
      windowId: 10,
      incognito: false,
      url: "https://youtube.com/watch?v=new",
      active: false,
      pinned: false,
    };
    tabs.push(source);

    expect(
      await sendMessage({
        type: "ASSIGN_WINDOW",
        ruleId: "youtube",
        windowId: 20,
        incognito: false,
      }),
    ).toEqual({ ok: true });

    events.updated.emit(source.id, { url: source.url }, structuredClone(source));
    await finishQueuedRouting();

    expect(moves).toEqual([{ tabId: 1, windowId: 20, index: -1 }]);
  });

  test("collects matching tabs even when automatic routing is disabled", async () => {
    tabs.push({
      id: 1,
      windowId: 10,
      incognito: false,
      url: "https://youtube.com/watch?v=one",
      active: false,
      pinned: false,
    });

    await sendMessage({
      type: "SET_RULE_ENABLED",
      ruleId: "youtube",
      enabled: false,
    });
    const response = await sendMessage({
      type: "COLLECT_TABS",
      ruleId: "youtube",
      windowId: 20,
      incognito: false,
    });

    expect(response).toEqual({ ok: true, count: 1 });
    expect(moves).toEqual([{ tabId: 1, windowId: 20, index: -1 }]);
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
