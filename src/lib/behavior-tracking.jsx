import { useEffect } from "react";

const CLICKABLE_SELECTOR = "button, a[href], summary, input, select, textarea, [role='button'], [role='tab']";
const MAX_BATCH_SIZE = 80;

function analyticsKey(value, fallback = "unknown") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || fallback;
}

function shortHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function pageViewId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function currentAnalyticsPage() {
  const candidates = [...document.querySelectorAll("[data-analytics-page]")];
  const visible = candidates.reverse().find((element) => element.getClientRects().length > 0);
  return visible?.dataset.analyticsPage || "";
}

function readableText(element) {
  return String(
    element.dataset.analyticsLabel
      || element.getAttribute("aria-label")
      || element.querySelector("strong")?.textContent
      || element.textContent
      || "",
  ).replace(/\s+/g, " ").trim().slice(0, 80);
}

function describeElement(element) {
  const id = element.id || "";
  if (id.startsWith("pin-key-")) {
    return { elementKey: "passcode-key", elementLabel: "数字密码键" };
  }
  if (id.startsWith("weight-key-")) {
    return { elementKey: "weight-key", elementLabel: "体重输入键" };
  }
  if (element.classList.contains("day-cell") || id.startsWith("day-")) {
    return { elementKey: "calendar-day", elementLabel: "日历日期" };
  }
  const label = readableText(element);
  const href = element.tagName === "A" ? element.getAttribute("href") : "";
  const rawKey = element.dataset.analyticsKey
    || id
    || element.getAttribute("name")
    || element.getAttribute("aria-label")
    || label
    || href
    || `${element.tagName.toLowerCase()}-${element.getAttribute("role") || "control"}`;
  return {
    elementKey: analyticsKey(rawKey, `${element.tagName.toLowerCase()}-${shortHash(rawKey)}`),
    elementLabel: label || null,
    targetPage: element.dataset.analyticsTarget || null,
  };
}

function sendEvents(events, clientUid) {
  if (!events.length) return;
  void fetch("/api/analytics/events", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(clientUid ? { clientUid } : {}),
      events: events.slice(0, MAX_BATCH_SIZE),
    }),
  }).catch(() => undefined);
}

export function BehaviorTracking({ enabled, clientUid = null }) {
  useEffect(() => {
    if (!enabled) return undefined;

    let activePage = "";
    let activePageViewId = "";
    let mutationFrame = 0;
    const impressions = new Set();
    let observedElements = new WeakSet();

    const takeImpression = (element) => {
      if (!activePage || !activePageViewId || element.disabled) return null;
      const descriptor = describeElement(element);
      const impressionKey = `${activePage}:${descriptor.elementKey}`;
      if (impressions.has(impressionKey)) return null;
      impressions.add(impressionKey);
      return {
        eventType: "impression",
        pageKey: activePage,
        pageViewId: activePageViewId,
        ...descriptor,
      };
    };

    const impressionObserver = new IntersectionObserver((entries) => {
      const events = [];
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const impression = takeImpression(entry.target);
        if (impression) events.push(impression);
      });
      for (let index = 0; index < events.length; index += MAX_BATCH_SIZE) {
        sendEvents(events.slice(index, index + MAX_BATCH_SIZE), clientUid);
      }
    }, { threshold: 0.15 });

    const enterCurrentPage = () => {
      const nextPage = analyticsKey(currentAnalyticsPage(), "");
      if (!nextPage || nextPage === activePage) return false;
      activePage = nextPage;
      activePageViewId = pageViewId();
      impressions.clear();
      impressionObserver.disconnect();
      observedElements = new WeakSet();
      sendEvents([{
        eventType: "page_view",
        pageKey: activePage,
        pageViewId: activePageViewId,
      }], clientUid);
      return true;
    };

    const collectImpressions = () => {
      enterCurrentPage();
      if (!activePage || !activePageViewId) return;
      const pageRoot = [...document.querySelectorAll("[data-analytics-page]")]
        .reverse()
        .find((element) => analyticsKey(element.dataset.analyticsPage, "") === activePage);
      if (!pageRoot) return;
      pageRoot.querySelectorAll(CLICKABLE_SELECTOR).forEach((element) => {
        if (element.disabled || observedElements.has(element)) return;
        observedElements.add(element);
        impressionObserver.observe(element);
      });
    };

    const scheduleCollection = () => {
      window.cancelAnimationFrame(mutationFrame);
      mutationFrame = window.requestAnimationFrame(collectImpressions);
    };

    const handleClick = (event) => {
      const element = event.target instanceof Element ? event.target.closest(CLICKABLE_SELECTOR) : null;
      if (!element || element.disabled) return;
      enterCurrentPage();
      if (!activePage || !activePageViewId) return;
      const descriptor = describeElement(element);
      const impressionKey = `${activePage}:${descriptor.elementKey}`;
      const events = [];
      if (!impressions.has(impressionKey)) {
        impressions.add(impressionKey);
        events.push({
          eventType: "impression",
          pageKey: activePage,
          pageViewId: activePageViewId,
          ...descriptor,
        });
      }
      events.push({
        eventType: "click",
        pageKey: activePage,
        pageViewId: activePageViewId,
        ...descriptor,
      });
      sendEvents(events, clientUid);
    };

    const observer = new MutationObserver(scheduleCollection);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", handleClick, true);
    scheduleCollection();

    return () => {
      observer.disconnect();
      impressionObserver.disconnect();
      document.removeEventListener("click", handleClick, true);
      window.cancelAnimationFrame(mutationFrame);
    };
  }, [clientUid, enabled]);

  return null;
}
