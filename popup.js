const STORAGE_KEY = "latestSnapshot";
const SITE_CONFIG = globalThis.CHINAUMS_SITE_CONFIG;
if (!SITE_CONFIG) throw new Error("银联商务站点配置未加载。");
const TARGET_HOST = SITE_CONFIG.host;
const PORTAL_ROOT = SITE_CONFIG.portalRoot;

const PAGE_ROUTES = SITE_CONFIG.pageRoutes;

const elements = {
  site: document.querySelector("#site-status"),
  login: document.querySelector("#login-status"),
  merchant: document.querySelector("#merchant-name"),
  merchantNo: document.querySelector("#merchant-no"),
  merchantStatus: document.querySelector("#merchant-status"),
  merchantTarget: document.querySelector("#merchant-target"),
  category: document.querySelector("#page-category"),
  reason: document.querySelector("#status-reason"),
  meta: document.querySelector("#page-meta"),
  title: document.querySelector("#page-title"),
  url: document.querySelector("#page-url"),
  counts: document.querySelector("#counts"),
  menus: document.querySelector("#count-menus"),
  businessEntries: document.querySelector("#count-business-entries"),
  interactiveElements: document.querySelector("#count-interactive-elements"),
  links: document.querySelector("#count-links"),
  buttons: document.querySelector("#count-buttons"),
  inputs: document.querySelector("#count-inputs"),
  selects: document.querySelector("#count-selects"),
  tables: document.querySelector("#count-tables"),
  iframes: document.querySelector("#count-iframes"),
  frames: document.querySelector("#count-frames"),
  text: document.querySelector("#count-text"),
  scanTime: document.querySelector("#scan-time"),
  scanButton: document.querySelector("#scan-button"),
  startExportTestButton: document.querySelector("#start-export-test-button"),
  startTradeExportButton: document.querySelector("#start-trade-export-button"),
  detailsButton: document.querySelector("#details-button"),
  copyButton: document.querySelector("#copy-button"),
  error: document.querySelector("#error-message")
};

const formatTime = (value) => {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return "";
  }
};

const safeUrlForDisplay = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|ticket|secret|password|session|auth|code|merchant|merid/i.test(key)) {
        url.searchParams.set(key, "[已隐藏]");
      }
    }
    if (/access_token|refresh_token|session|auth/i.test(url.hash)) url.hash = "#[已隐藏]";
    return url.href;
  } catch {
    return rawUrl || "";
  }
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
const matchesPath = (path, route) => {
  if (route.exact) return path === route.exact;
  return path === route.prefix || path.startsWith(`${route.prefix}/`);
};

const routeCategory = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== TARGET_HOST) return null;
    return PAGE_ROUTES.find((route) => matchesPath(url.pathname, route)) || null;
  } catch {
    return null;
  }
};

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
    current.replace(/\s/g, "") === target.replace(/\s/g, "") ? "matched" : "mismatched";

  return {
    target,
    current,
    targetMerchantNo: null,
    currentMerchantNo: currentNo,
    verified: false,
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

const classifyPage = (topFrame, frames) => {
  const byRoute = routeCategory(topFrame.url);
  if (byRoute) return { category: byRoute.category, confidence: "high", source: "url" };

  let path = "";
  try {
    path = new URL(topFrame.url).pathname;
  } catch {
    // Let DOM-based classification handle URLs that cannot be parsed.
  }
  const text = frames.map((frame) => [
    frame.title,
    frame.visibleText,
    ...(frame.headings || []),
    ...(frame.menus || []),
    ...(frame.businessEntries || []).map((item) => item.text),
    ...(frame.buttons || []).map((item) => item.text),
    ...(frame.links || []).map((item) => item.text)
  ].join(" ")).join(" ");

  let category = "未知页面";
  if (/导出任务|下载任务|任务列表|下载记录/.test(text)) category = "导出任务";
  else if (/报表.{0,8}(下载|导出)|(下载|导出).{0,8}报表/.test(text)) category = "报表页面";
  else if (/交易查询|对账查询|查询结果|查询条件/.test(text) ||
    (/查询/.test(text) && frames.some((frame) => frame.tables?.length))) category = "查询页面";
  else if (/轻应用|推荐产品|常用功能/.test(text) && path === "/uisportal/index_r") category = "首页";
  else if (frames.some((frame) => frame.mainNavigation?.length)) category = "业务页面";

  return {
    category,
    confidence: category === "未知页面" ? "low" : "medium",
    source: "dom"
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

const makeSnapshot = (injectionResults, injectionNote, tabUrl) => {
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
  const interactiveElements = dedupeBy(
    relevantFrames.flatMap((frame) => attachFrame(frame.interactiveElements, frame)),
    (item) => `${item.text}|${item.selector}|${item.frameId}`
  );
  const buttons = dedupeBy(
    relevantFrames.flatMap((frame) => attachFrame(frame.buttons, frame)),
    (item) => `${item.text}|${item.selector}|${item.frameId}`
  );
  const allInputs = relevantFrames.flatMap((frame) => attachFrame(frame.inputs, frame));
  const inputs = dedupeBy(allInputs.filter((item) => item.tag !== "select"),
    (item) => `${item.name}|${item.id}|${item.type}|${item.frameId}`);
  const selects = dedupeBy(allInputs.filter((item) => item.tag === "select"),
    (item) => `${item.name}|${item.id}|${item.type}|${item.frameId}`);
  const links = dedupeBy(
    relevantFrames.flatMap((frame) => attachFrame(frame.links, frame)),
    (item) => `${item.text}|${item.href}`
  );
  const headings = dedupeBy(
    relevantFrames.flatMap((frame) => attachFrame(frame.headings, frame)),
    (item) => `${item.text}|${item.frameId}`
  );
  const tables = dedupeBy(
    relevantFrames.flatMap((frame) => attachFrame(frame.tables, frame)),
    (item) => `${item.frameId}|${item.index}`
  );
  const downloadTaskLists = relevantFrames
    .filter((frame) => frame.downloadTaskList)
    .map((frame) => ({
      ...frame.downloadTaskList,
      frameId: frame.frameId,
      frameTitle: frame.title,
      frameUrl: frame.url
    }));

  const iframeItems = scannedFrames.flatMap((parentFrame) =>
    (parentFrame.iframes || []).map((item) => {
      const matchedDocument = scannedFrames.find((frame) =>
        frame.frameId !== parentFrame.frameId &&
        (sameDocumentUrl(frame.url, item.documentUrl || item.url) || sameDocumentUrl(frame.url, item.url))
      );
      return {
        ...item,
        parentFrameId: parentFrame.frameId,
        parentFrameUrl: parentFrame.url,
        scanned: Boolean((item.documentUrl || item.url) && matchedDocument),
        scannedFrameId: matchedDocument?.frameId ?? null
      };
    })
  );
  const notes = [];
  if (injectionNote) notes.push(injectionNote);
  if (collectedFrames.length > scannedFrames.length) notes.push("frame 数量超过快照上限，结果只保留前 24 个。");
  const unscannedIframes = iframeItems.filter((item) => !item.scanned).length;
  if (unscannedIframes) {
    notes.push(`${unscannedIframes} 个 iframe 未能与可扫描 frame 对应；跨域 frame 可能受当前标签页权限限制。`);
  }

  const login = globalThis.CHINAUMS_AUTH.classify(topFrame.url, relevantFrames, mainNavigation, businessEntries);
  const merchant = classifyMerchant(relevantFrames);
  const businessGate = {
    allowed: false,
    reasons: ["页面扫描快照不作为导出门禁；运行时从查询结果读取商户号"]
  };
  const page = classifyPage(topFrame, relevantFrames);
  const visibleText = relevantFrames.map((frame) => frame.visibleText || "")
    .filter(Boolean).join("\n").slice(0, 14000);
  const scannedDocuments = scannedFrames.map((frame) => {
    let path = "";
    try {
      path = new URL(frame.url).pathname;
    } catch {
      // Keep the frame record even if its URL is malformed.
    }
    return {
      frameId: frame.frameId,
      isTopFrame: Boolean(frame.isTopFrame),
      type: frame.isTopFrame ? "shell" :
        path === SITE_CONFIG.frontendRoot || path.startsWith(`${SITE_CONFIG.frontendRoot}/`) ? "business" : "portal",
      url: frame.url,
      title: frame.title
    };
  });

  return {
    schemaVersion: 3,
    scannedAt: new Date().toISOString(),
    account: null,
    site: { recognized: true, host: TARGET_HOST },
    page: {
      url: topFrame.url,
      title: topFrame.title,
      category: page.category,
      categoryConfidence: page.confidence,
      categorySource: page.source
    },
    authentication: login,
    merchant,
    businessGate,
    navigation: { main: mainNavigation, businessEntries },
    controls: { buttons, interactiveElements, inputs, selects, links },
    content: { headings, tables, downloadTaskLists, visibleText },
    frames: { count: iframeItems.length, items: iframeItems, scannedDocuments },
    frameScan: { complete: notes.length === 0, note: notes.join(" ") },
    counts: {
      mainNavigation: mainNavigation.length,
      businessEntries: businessEntries.length,
      interactiveElements: interactiveElements.length,
      links: links.length,
      buttons: buttons.length,
      inputs: inputs.length,
      selects: selects.length,
      tables: tables.length,
      downloadTaskLists: downloadTaskLists.length,
      iframes: iframeItems.length,
      scannedDocuments: scannedDocuments.length,
      visibleTextChars: Array.from(visibleText).length
    }
  };
};

const injectAndScan = async (tabId) => {
  let injectionNote = "";
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
  } catch (allFramesError) {
    injectionNote = `部分 frame 无法注入：${allFramesError.message || "权限或页面状态不允许注入"}`;
  }

  try {
    const results = await scanInFrames(true);
    return { results, injectionNote };
  } catch (allFramesError) {
    const scanNote = `全帧读取不完整：${allFramesError.message || "部分 frame 当前不可访问"}`;
    injectionNote = [injectionNote, scanNote].filter(Boolean).join("；");
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    const results = await scanInFrames(false);
    return { results, injectionNote };
  }
};

const setLoginDisplay = (authentication) => {
  const labels = { logged_in: "✓ 已登录", logged_out: "未登录", unknown: "无法确定" };
  elements.login.textContent = labels[authentication?.status] || "尚未检测";
  elements.login.className = authentication?.status === "logged_in"
    ? "status-positive"
    : authentication?.status === "logged_out" ? "status-negative" : "";
  const reasons = authentication?.reasons || [];
  const confidence = authentication?.confidence
    ? `置信度：${({ high: "高", medium: "中", low: "低" })[authentication.confidence] || "未知"}`
    : "";
  const score = Number.isFinite(authentication?.score) ? `评分：${authentication.score}` : "";
  elements.reason.textContent = [...reasons, confidence, score].filter(Boolean).join("；") || "点击检测后读取当前页面。";
};

const setMerchantDisplay = (merchant) => {
  elements.merchant.textContent = merchant?.current || "未识别";
  const statusLabels = {
    matched: "名称线索一致",
    mismatched: "商户名称不一致",
    unknown: "? 待确认"
  };
  elements.merchantStatus.textContent = merchant?.status === "matched"
    ? "名称线索一致；商户号待查询核对"
    : statusLabels[merchant?.status] || "? 待确认";
  elements.merchantStatus.className = merchant?.status === "mismatched" ? "status-negative" : "";
  elements.merchantNo.textContent = merchant?.currentMerchantNo || "未读取";
  elements.merchantTarget.textContent = `商户名称线索：${merchant?.target || SITE_CONFIG.targetMerchant}；商户号在报表查询结果中识别`;
};

const renderSummary = (snapshot) => {
  elements.site.textContent = snapshot?.site?.recognized ? "✓ 银联商务" : "非目标网站";
  elements.site.className = snapshot?.site?.recognized ? "status-positive" : "status-negative";
  setLoginDisplay(snapshot?.authentication);
  setMerchantDisplay(snapshot?.merchant);
  elements.category.textContent = snapshot?.page?.category || "未知页面";
  elements.meta.classList.remove("hidden");
  elements.counts.classList.remove("hidden");
  elements.title.textContent = snapshot?.page?.title || "（无页面标题）";
  elements.url.textContent = snapshot?.page?.url || "";
  elements.menus.textContent = snapshot?.counts?.mainNavigation ?? 0;
  elements.businessEntries.textContent = snapshot?.counts?.businessEntries ?? 0;
  elements.interactiveElements.textContent = snapshot?.counts?.interactiveElements ?? 0;
  elements.links.textContent = snapshot?.counts?.links ?? 0;
  elements.buttons.textContent = snapshot?.counts?.buttons ?? 0;
  elements.inputs.textContent = snapshot?.counts?.inputs ?? 0;
  elements.selects.textContent = snapshot?.counts?.selects ?? 0;
  elements.tables.textContent = snapshot?.counts?.tables ?? 0;
  elements.iframes.textContent = snapshot?.frames?.count ?? 0;
  elements.frames.textContent = snapshot?.counts?.scannedDocuments ?? 0;
  elements.text.textContent = snapshot?.counts?.visibleTextChars ?? 0;
  elements.scanTime.textContent = `最近检测：${formatTime(snapshot?.scannedAt)}`;
  elements.detailsButton.disabled = false;
  elements.copyButton.disabled = false;
};

const renderRouteOnly = (tab) => {
  const route = routeForUrl(tab?.url || "");
  elements.site.textContent = route.recognized ? "✓ 银联商务" : "当前不是目标网站";
  elements.site.className = route.recognized ? "status-positive" : "status-negative";
  elements.meta.classList.remove("hidden");
  elements.title.textContent = tab?.title || "（无页面标题）";
  elements.url.textContent = safeUrlForDisplay(tab?.url || "");
  elements.merchant.textContent = "未识别";
  elements.merchantNo.textContent = "未读取";
  elements.counts.classList.add("hidden");
  elements.scanTime.textContent = "";
  elements.detailsButton.disabled = true;
  elements.copyButton.disabled = true;

  if (route.kind === "login_page") {
    elements.category.textContent = "门户 / 登录入口";
    setLoginDisplay({
      status: "logged_out",
      confidence: "medium",
      reasons: ["当前 URL 是门户入口或登录相关路径"]
    });
    setMerchantDisplay({ status: "unknown", target: SITE_CONFIG.targetMerchant });
  } else if (route.kind === "other_page") {
    elements.category.textContent = "非门户页面";
    setLoginDisplay({ status: "unknown", reasons: ["探测范围限定为银联商务门户路径"] });
    setMerchantDisplay({ status: "unknown", target: SITE_CONFIG.targetMerchant });
  } else if (["portal_page", "business_frame_page"].includes(route.kind)) {
    elements.category.textContent = routeCategory(tab.url)?.category || "银联商务页面";
    setLoginDisplay({ status: "unknown", reasons: ["当前页面可以扫描；点击检测后读取 DOM 特征"] });
    setMerchantDisplay({ status: "unknown", target: SITE_CONFIG.targetMerchant });
    setBusinessGateDisplay({ allowed: false });
  } else {
    elements.category.textContent = "—";
    setLoginDisplay({ status: "unknown", reasons: ["请打开银联商务门户页面"] });
    setMerchantDisplay({ status: "unknown", target: SITE_CONFIG.targetMerchant });
    setBusinessGateDisplay({ allowed: false });
  }
};

const showUnsavedPageState = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const snapshot = stored[STORAGE_KEY];
    if (snapshot?.schemaVersion === 3 && safeUrlForDisplay(tab?.url) === snapshot.page?.url) {
      renderSummary(snapshot);
    } else {
      renderRouteOnly(tab);
    }
  } catch {
    elements.site.textContent = "等待检测";
  }
};

elements.scanButton.addEventListener("click", async () => {
  elements.error.textContent = "";
  elements.scanButton.disabled = true;
  elements.scanButton.textContent = "正在检测…";
  elements.reason.textContent = "正在读取当前页面结构。";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) throw new Error("无法获取当前标签页。");
    if (!isScannableTargetUrl(tab.url)) {
      renderRouteOnly(tab);
      return;
    }

    const { results, injectionNote } = await injectAndScan(tab.id);
    const snapshot = makeSnapshot(results, injectionNote, tab.url);
    await chrome.storage.local.set({ [STORAGE_KEY]: snapshot });
    renderSummary(snapshot);
    if (snapshot.frameScan.note) {
      elements.reason.textContent = `${elements.reason.textContent}；${snapshot.frameScan.note}`;
    }
  } catch (error) {
    elements.error.textContent = error?.message || "检测失败，请确认页面可访问后重试。";
    elements.reason.textContent = "没有保存新的页面快照。";
  } finally {
    elements.scanButton.disabled = false;
    elements.scanButton.textContent = "检测当前页面";
  }
});

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

elements.detailsButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("details.html") });
});

elements.copyButton.addEventListener("click", async () => {
  elements.error.textContent = "";
  const originalLabel = elements.copyButton.textContent;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const snapshot = stored[STORAGE_KEY];
    if (snapshot?.schemaVersion !== 3) throw new Error("请先重新检测，生成新版页面快照。");
    const serialized = JSON.stringify(snapshot, null, 2);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(serialized);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = serialized;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("浏览器未允许访问剪贴板。");
    }
    elements.copyButton.textContent = "已复制 JSON";
    window.setTimeout(() => { elements.copyButton.textContent = originalLabel; }, 1500);
  } catch (error) {
    elements.error.textContent = error?.message || "复制失败。";
  }
});

showUnsavedPageState().finally(refreshExportTestButton);
