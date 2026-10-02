const STORAGE_KEY = "latestSnapshot";
const SITE_CONFIG = globalThis.CHINAUMS_SITE_CONFIG;
if (!SITE_CONFIG) throw new Error("银联商务站点配置未加载。");
const TARGET_HOST = SITE_CONFIG.host;
const PORTAL_ROOT = SITE_CONFIG.portalRoot;

const elements = {
  site: document.querySelector("#site-status"),
  login: document.querySelector("#login-status"),
  merchant: document.querySelector("#merchant-name"),
  startExportTestButton: document.querySelector("#start-export-test-button"),
  startTradeExportButton: document.querySelector("#start-trade-export-button"),
  error: document.querySelector("#error-message")
};

const routeForUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.hostname !== TARGET_HOST) {
      return { kind: "other_site", recognized: false, url };
    }
    const path = url.pathname;
    if (path === PORTAL_ROOT || path === `${PORTAL_ROOT}/` || /login|signin|auth/i.test(path)) {
      return { kind: "login_page", recognized: true, url };
    }
    if (path.startsWith(`${PORTAL_ROOT}/`)) {
      return { kind: "portal_page", recognized: true, url };
    }
    if (path === SITE_CONFIG.frontendRoot || path.startsWith(`${SITE_CONFIG.frontendRoot}/`)) {
      return { kind: "business_frame_page", recognized: true, url };
    }
    return { kind: "other_page", recognized: true, url };
  } catch {
    return { kind: "other_site", recognized: false, url: null };
  }
};

const isScannableTargetUrl = (rawUrl) => ["portal_page", "business_frame_page"].includes(routeForUrl(rawUrl).kind);
const dedupeBy = (items, keyOf) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const attachFrame = (items, frame) => (items || []).map((item) => ({
  ...(typeof item === "string" ? { text: item } : item),
  frameId: frame.frameId,
  frameTitle: frame.title,
  frameUrl: frame.url
}));

const refreshExportTestButton = async () => {
  const buttons = [elements.startExportTestButton, elements.startTradeExportButton];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const ready = Boolean(activeTab?.id && activeTab.url && routeForUrl(activeTab.url).kind === "portal_page");
    buttons.forEach((button) => { button.disabled = !ready; });
  } catch {
    buttons.forEach((button) => { button.disabled = true; });
  }
};

const classifyMerchant = (frames) => {
  const candidates = frames
    .map((frame) => ({ merchant: frame.merchant || {}, isTopFrame: Boolean(frame.isTopFrame) }))
    .sort((left, right) => {
      const sourceRank = { "merchant-details": 4, "merchant-panel": 3, "top-navigation": 2, "data-attribute": 1 };
      const leftRank = sourceRank[left.merchant.source] || 0;
      const rightRank = sourceRank[right.merchant.source] || 0;
      return rightRank - leftRank || Number(right.isTopFrame) - Number(left.isTopFrame);
  });
  const selected = candidates.find((item) => item.merchant.current)?.merchant || {};
  const merchantControl = candidates.find((item) => item.merchant.merchantControl?.found)?.merchant.merchantControl || { found: false };
  const switchControl = candidates.find((item) => item.merchant.switchControl?.found)?.merchant.switchControl || { found: false };
  const current = selected.current || null;
  const currentNo = selected.merchantNo || null;
  const target = selected.target || frames.find((frame) => frame.merchant?.target)?.merchant.target || SITE_CONFIG.targetMerchant;
  const status = !current ? "unknown" :
    (!target || current.replace(/\s/g, "") === target.replace(/\s/g, "")) ? "matched" : "detected";

  return {
    target,
    current,
    currentMerchantNo: currentNo,
    status,
    confidence: current ? selected.confidence || "low" : "low",
    source: current ? selected.source || null : null,
    merchantControl,
    switchControl,
    merchantPanel: {
      visible: candidates.some((item) => item.merchant.merchantPanel?.visible),
      currentMerchantLabelVisible: candidates.some((item) => item.merchant.merchantPanel?.currentMerchantLabelVisible),
      merchantNameLabelVisible: candidates.some((item) => item.merchant.merchantPanel?.merchantNameLabelVisible),
      switchAvailable: candidates.some((item) => item.merchant.merchantPanel?.switchAvailable)
    }
  };
};

const sameDocumentUrl = (left, right) => {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return Boolean(left && right && left === right);
  }
};

const makeSnapshot = (injectionResults, tabUrl) => {
  const collectedFrames = injectionResults
    .map((entry) => entry.result ? { ...entry.result, frameId: entry.frameId } : null)
    .filter(Boolean);
  const topFrame = collectedFrames.find((frame) => frame.isTopFrame) || collectedFrames[0];
  if (!topFrame) throw new Error("没有读取到页面内容。请确认页面已加载后重试。");
  if (!isScannableTargetUrl(topFrame.url) || !sameDocumentUrl(topFrame.url, tabUrl)) {
    throw new Error("扫描期间页面地址发生变化；请停留在银联商务页面后重试。");
  }

  const scannedFrames = [topFrame, ...collectedFrames.filter((frame) => frame !== topFrame)].slice(0, 24);
  const relevantFrames = scannedFrames.filter((frame) => {
    try {
      return new URL(frame.url).hostname === TARGET_HOST;
    } catch {
      return false;
    }
  });
  if (!relevantFrames.some((frame) => frame.isTopFrame)) relevantFrames.unshift(topFrame);

  const mainNavigation = dedupeBy(
    relevantFrames.flatMap((frame) => attachFrame(frame.mainNavigation, frame)),
    (item) => `${item.text}|${item.pathname}`
  );
  const businessEntries = dedupeBy(
    relevantFrames.flatMap((frame) => attachFrame(frame.businessEntries, frame)),
    (item) => `${item.text}|${item.target}`
  );

  const login = globalThis.CHINAUMS_AUTH.classify(topFrame.url, relevantFrames, mainNavigation, businessEntries);
  const merchant = classifyMerchant(relevantFrames);

  return {
    scannedAt: new Date().toISOString(),
    site: { recognized: true, host: TARGET_HOST },
    page: { url: topFrame.url, title: topFrame.title },
    authentication: login,
    merchant
  };
};

const injectAndScan = async (tabId) => {
  const scanConfig = {
    host: SITE_CONFIG.host,
    portalRoot: SITE_CONFIG.portalRoot,
    frontendRoot: SITE_CONFIG.frontendRoot,
    targetMerchant: SITE_CONFIG.targetMerchant,
    mainNavigation: SITE_CONFIG.mainNavigation.map(({ path, label }) => ({ path, label }))
  };
  const scanInFrames = (allFrames) => chrome.scripting.executeScript({
    target: allFrames ? { tabId, allFrames: true } : { tabId },
    func: (config) => typeof globalThis.__chinaumsAssistantScan === "function"
      ? globalThis.__chinaumsAssistantScan(config)
      : null,
    args: [scanConfig]
  });

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"]
    });
  } catch {}

  try {
    return await scanInFrames(true);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return scanInFrames(false);
  }
};

const setLoginDisplay = (authentication) => {
  const labels = { logged_in: "✓ 已登录", logged_out: "未登录", unknown: "无法确定" };
  elements.login.textContent = labels[authentication?.status] || "尚未检测";
  elements.login.className = authentication?.status === "logged_in"
    ? "status-positive"
    : authentication?.status === "logged_out" ? "status-negative" : "";
};

const setMerchantDisplay = (merchant) => {
  if (!elements.merchant) return;
  elements.merchant.textContent = merchant?.current || "未识别（沿用当前商户）";
};

const renderSummary = (snapshot) => {
  if (elements.site) {
    elements.site.textContent = snapshot?.site?.recognized ? "✓ 银联商务" : "非目标网站";
    elements.site.className = snapshot?.site?.recognized ? "status-positive" : "status-negative";
  }
  setLoginDisplay(snapshot?.authentication);
  setMerchantDisplay(snapshot?.merchant);
};

const renderRouteOnly = (tab) => {
  const route = routeForUrl(tab?.url || "");
  if (elements.site) {
    elements.site.textContent = route.recognized ? "✓ 银联商务" : "当前不是目标网站";
    elements.site.className = route.recognized ? "status-positive" : "status-negative";
  }
  if (elements.merchant) elements.merchant.textContent = "检测中…";

  if (route.kind === "login_page") {
    setLoginDisplay({
      status: "logged_out",
      confidence: "medium",
      reasons: ["当前 URL 是门户入口或登录相关路径"]
    });
  } else if (route.kind === "other_page" || route.kind === "other_site") {
    setLoginDisplay({ status: "unknown", reasons: ["请在银联商务门户页面使用"] });
  } else {
    setLoginDisplay({ status: "logged_in", confidence: "medium", reasons: ["检测到门户路由，正在读取商户信息…"] });
  }
};

const showUnsavedPageState = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;
    renderRouteOnly(tab);
    if (!isScannableTargetUrl(tab.url)) return;

    const results = await injectAndScan(tab.id);
    const snapshot = makeSnapshot(results, tab.url);
    await chrome.storage.local.set({ [STORAGE_KEY]: snapshot });
    renderSummary(snapshot);
  } catch (error) {
    if (elements.error) elements.error.textContent = error?.message || "";
  }
};

const startExport = async (reportType) => {
  elements.error.textContent = "";
  elements.startExportTestButton.disabled = true;
  elements.startTradeExportButton.disabled = true;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = activeTab;
    if (!tab?.id || !tab.url || routeForUrl(tab.url).kind !== "portal_page") {
      throw new Error("请先打开已登录的银联商务门户页面。");
    }
    const runnerUrl = new URL(chrome.runtime.getURL("export.html"));
    runnerUrl.searchParams.set("tabId", String(tab.id));
    runnerUrl.searchParams.set("reportType", reportType);
    await chrome.tabs.create({ url: runnerUrl.href });
    window.close();
  } catch (error) {
    elements.error.textContent = error?.message || "无法启动报表导出。";
    await refreshExportTestButton();
  }
};

elements.startExportTestButton.addEventListener("click", () => startExport("account-detail"));
elements.startTradeExportButton.addEventListener("click", () => startExport("trade-audit"));

showUnsavedPageState().finally(refreshExportTestButton);
