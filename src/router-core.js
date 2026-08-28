export const DEFAULT_RULES = Object.freeze([
  {
    id: "youtube",
    name: "YouTube",
    domains: ["youtube.com", "youtu.be"],
    enabled: true,
  },
  {
    id: "x-twitter",
    name: "X / Twitter",
    domains: ["x.com", "twitter.com"],
    enabled: true,
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    domains: ["linkedin.com"],
    enabled: true,
  },
  {
    id: "github",
    name: "GitHub",
    domains: ["github.com"],
    enabled: true,
  },
]);

export function normalizeDomain(input) {
  const value = String(input ?? "").trim().toLowerCase();
  if (!value) return null;

  const withoutWildcard = value.replace(/^\*\./, "");

  try {
    const parsed = new URL(
      withoutWildcard.includes("://")
        ? withoutWildcard
        : `https://${withoutWildcard}`,
    );
    const hostname = parsed.hostname.replace(/^www\./, "").replace(/\.$/, "");
    if (!hostname || hostname.includes("..")) return null;
    if (!/^[a-z0-9.-]+$/.test(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

export function urlMatchesRule(url, rule) {
  if (!rule?.enabled || !url) return false;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return rule.domains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

export function bindingKey(ruleId, incognito) {
  return `${ruleId}:${incognito ? "incognito" : "regular"}`;
}

export function selectDestinationWindow(tabs, rule, sourceWindowId, incognito) {
  const counts = new Map();

  for (const tab of tabs) {
    if (Boolean(tab.incognito) !== Boolean(incognito)) continue;
    if (!urlMatchesRule(tab.url, rule)) continue;
    counts.set(tab.windowId, (counts.get(tab.windowId) ?? 0) + 1);
  }

  const candidates = [...counts.entries()].sort(([windowA, countA], [windowB, countB]) => {
    if (countA !== countB) return countB - countA;
    if (windowA === sourceWindowId && windowB !== sourceWindowId) return 1;
    if (windowB === sourceWindowId && windowA !== sourceWindowId) return -1;
    return windowA - windowB;
  });

  return candidates[0]?.[0] ?? sourceWindowId ?? null;
}

export function sanitizeRules(rules) {
  if (!Array.isArray(rules)) return [];

  const usedIds = new Set();
  return rules.flatMap((rule, index) => {
    const name = String(rule?.name ?? "").trim();
    const domains = [
      ...new Set(
        (Array.isArray(rule?.domains) ? rule.domains : [])
          .map(normalizeDomain)
          .filter(Boolean),
      ),
    ];
    if (!name || domains.length === 0) return [];

    let id = String(rule?.id ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id) id = `rule-${index + 1}`;
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);

    return [{ id, name, domains, enabled: rule.enabled !== false }];
  });
}
