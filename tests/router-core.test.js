import { describe, expect, test } from "bun:test";
import {
  normalizeDomain,
  sanitizeRules,
  selectDestinationWindow,
  urlMatchesRule,
} from "../src/router-core.js";

const youtubeRule = {
  id: "youtube",
  name: "YouTube",
  domains: ["youtube.com", "youtu.be"],
  enabled: true,
};

describe("domain matching", () => {
  test("matches the domain and its subdomains without matching lookalikes", () => {
    expect(urlMatchesRule("https://youtube.com/watch?v=1", youtubeRule)).toBe(true);
    expect(urlMatchesRule("https://music.youtube.com/", youtubeRule)).toBe(true);
    expect(urlMatchesRule("https://notyoutube.com/", youtubeRule)).toBe(false);
    expect(urlMatchesRule("chrome://extensions", youtubeRule)).toBe(false);
  });

  test("normalizes domains copied as full URLs", () => {
    expect(normalizeDomain(" HTTPS://www.LinkedIn.com/company/example ")).toBe("linkedin.com");
    expect(normalizeDomain("*.github.com")).toBe("github.com");
    expect(normalizeDomain("not a domain")).toBeNull();
  });
});

describe("destination recovery", () => {
  test("chooses the window that already contains the most matching tabs", () => {
    const tabs = [
      { windowId: 10, incognito: false, url: "https://youtube.com/watch?v=a" },
      { windowId: 20, incognito: false, url: "https://youtube.com/watch?v=b" },
      { windowId: 20, incognito: false, url: "https://youtu.be/c" },
      { windowId: 30, incognito: false, url: "https://github.com/openai" },
    ];

    expect(selectDestinationWindow(tabs, youtubeRule, 10, false)).toBe(20);
  });

  test("prefers an existing matching window over a tied source window", () => {
    const tabs = [
      { windowId: 10, incognito: false, url: "https://youtube.com/watch?v=new" },
      { windowId: 20, incognito: false, url: "https://youtube.com/watch?v=existing" },
    ];

    expect(selectDestinationWindow(tabs, youtubeRule, 10, false)).toBe(20);
  });

  test("never crosses into an incognito window", () => {
    const tabs = [
      { windowId: 10, incognito: false, url: "https://youtube.com/watch?v=a" },
      { windowId: 20, incognito: true, url: "https://youtube.com/watch?v=b" },
      { windowId: 20, incognito: true, url: "https://youtube.com/watch?v=c" },
    ];

    expect(selectDestinationWindow(tabs, youtubeRule, 10, false)).toBe(10);
  });
});

describe("rule sanitation", () => {
  test("removes invalid rules and duplicate domains", () => {
    expect(
      sanitizeRules([
        {
          id: "Docs Group",
          name: "Docs",
          domains: ["https://www.example.com/path", "example.com"],
          enabled: true,
        },
        { id: "empty", name: "", domains: ["example.org"], enabled: true },
      ]),
    ).toEqual([
      {
        id: "docs-group",
        name: "Docs",
        domains: ["example.com"],
        enabled: true,
      },
    ]);
  });
});
