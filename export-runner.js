const SITE_CONFIG = globalThis.CHINAUMS_SITE_CONFIG;
const RUN_KEY = "activeExportRun";
const ARCHIVE_KEY = "archivedExportRuns";
const params = new URLSearchParams(location.search);
const tabId = Number(params.get("tabId"));
const reportType = params.get("reportType") || "account-detail";
const elements = {
  target: document.querySelector("#export-target"),
  status: document.querySelector("#export-status"),
  stage: document.querySelector("#export-stage"),
  month: document.querySelector("#export-month"),
  progress: document.querySelector("#export-progress"),
  downloadProgress: document.querySelector("#export-download-progress"),
  gate: document.querySelector("#export-gate"),
  pause: document.querySelector("#export-pause"),
  resume: document.querySelector("#export-resume"),
  stop: document.querySelector("#export-stop"),
  close: document.querySelector("#export-close"),
  result: document.querySelector("#export-result"),
  resultTitle: document.querySelector("#export-result-title"),
  resultMessage: document.querySelector("#export-result-message"),
  log: document.querySelector("#export-log")
};

let state = null;
let paused = false;
let stopRequested = false;
let lastResultStatus = null;
let pausedAt = null;
let pausedDuration = 0;
// Flow waits exclude pauses; adapter requests and server retention keep real deadlines.
const activeNow = () => (pausedAt ?? Date.now()) - pausedDuration;
const finishPause = () => {
  if (pausedAt !== null) pausedDuration += Date.now() - pausedAt;
  pausedAt = null;
};

const statusLabels = {
  GATING: "检查登录会话", RUNNING: "运行中", PAUSED: "已暂停",
  WAITING_FOR_SLOT: "等待申请额度", WAITING_GENERATION: "等待文件生成",
  ALL_MONTHS_SUBMITTED: "所有月份申请完成", DOWNLOADING: "下载中",
  DOWNLOAD_REQUESTS_SENT: "所有文件下载完成", COMPLETED: "已完成",
  BLOCKED: "导出失败，流程已停止", STOPPED: "用户停止"
};

const renderResult = (status, error = "", submitted = 0, downloaded = 0) => {
  const terminal = ["COMPLETED", "BLOCKED", "STOPPED"].includes(status);
  elements.result.hidden = !terminal;
  if (!terminal) {
    document.title = "报表导出 | 银联商务助手";
    lastResultStatus = null;
    return;
  }
  const success = status === "COMPLETED";
  const stopped = status === "STOPPED";
  const title = success ? (submitted ? "✓ 导出完成" : "✓ 流程完成，本轮无数据")
    : stopped ? "■ 已停止" : "✕ 导出失败，流程已停止";
  elements.result.className = `export-result export-result-${success ? "success" : stopped ? "stopped" : "failure"}`;
  elements.result.setAttribute("role", status === "BLOCKED" ? "alert" : "status");
  elements.resultTitle.textContent = title;
  elements.resultMessage.textContent = success
    ? (submitted ? `Chrome 已确认 ${downloaded} / ${submitted} 个文件下载完成。请在 Chrome 下载记录中查看文件。`
      : "本轮查询均无数据，没有提交导出申请，也没有需要下载的文件。")
    : `${error}\n已确认下载完成 ${downloaded} / ${submitted} 个已提交文件。服务器已接受的任务仍会保留，请核对暂存列表和 Chrome 下载记录。`;
  document.title = `${title} | 银联商务助手`;
  if (lastResultStatus !== status) elements.result.scrollIntoView({ block: "start" });
  lastResultStatus = status;
};

const sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const withTimeout = (promise, milliseconds, operation) => {
  let timerId;
  const timeout = new Promise((_, reject) => {
    timerId = window.setTimeout(
      () => reject(new Error(`页面操作“${operation}”在${Math.ceil(milliseconds / 1000)}秒内没有响应。`)),
      milliseconds
    );
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timerId));
};
const normalize = (value) => String(value ?? "").replace(/[\s\u200B-\u200D\uFEFF]/g, "").toUpperCase();
const safeUrlForStorage = (rawUrl) => {
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
    return "";
  }
};
const scannerConfig = {
  host: SITE_CONFIG.host,
  portalRoot: SITE_CONFIG.portalRoot,
  frontendRoot: SITE_CONFIG.frontendRoot,
  targetMerchant: SITE_CONFIG.targetMerchant,
  mainNavigation: SITE_CONFIG.mainNavigation.map(({ path, label }) => ({ path, label }))
};

const updateButtons = () => {
  const activeStatuses = ["GATING", "RUNNING", "WAITING_GENERATION", "WAITING_FOR_SLOT", "ALL_MONTHS_SUBMITTED", "DOWNLOADING"];
  elements.pause.disabled = !state || !activeStatuses.includes(state.status) || paused;
  elements.resume.disabled = !paused || stopRequested;
  elements.stop.disabled = !state || ["COMPLETED", "BLOCKED", "STOPPED"].includes(state.status) || stopRequested;
  elements.close.disabled = !state || !["COMPLETED", "BLOCKED", "STOPPED"].includes(state.status);
};

const appendLog = (message) => {
  if (state?.logs.at(-1) === message) return;
  const item = document.createElement("li");
  item.textContent = `${new Intl.DateTimeFormat("zh-CN", { timeStyle: "medium" }).format(new Date())}　${message}`;
  elements.log.append(item);
  item.scrollIntoView({ block: "nearest" });
  if (state) {
    state.logs.push(message);
    state.logs = state.logs.slice(-200);
  }
};

const saveState = async () => {
  if (!state) return;
  state.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [RUN_KEY]: state });
};

const renderState = () => {
  if (!state) return;
  elements.status.textContent = statusLabels[state.status] || "运行中";
  elements.stage.textContent = state.stage || state.status || "—";
  elements.month.textContent = state.currentMonth || "—";
  const completed = Object.values(state.months || {}).filter((item) => ["SUBMITTED", "NO_DATA"].includes(item.status)).length;
  elements.progress.textContent = `${completed} / ${state.monthOrder.length}`;
  const submitted = Object.values(state.months || {}).filter((item) => item.status === "SUBMITTED").length;
  const downloadRequested = Object.values(state.months || {}).filter((item) => item.downloadStatus === "COMPLETED").length;
  if (["COMPLETED", "WAITING_GENERATION", "DOWNLOADING", "DOWNLOAD_REQUESTS_SENT"].includes(state.status)) {
    elements.downloadProgress.textContent = state.status === "WAITING_GENERATION"
      ? `${downloadRequested} / ${submitted} 个文件已完成下载，等待剩余文件生成`
      : `${downloadRequested} / ${submitted} 个文件已完成下载`;
  } else if (submitted && ["BLOCKED", "STOPPED"].includes(state.status)) {
    elements.downloadProgress.textContent = `${downloadRequested} / ${submitted} 个文件已确认下载完成，流程已停止`;
  } else {
    elements.downloadProgress.textContent = "所有月份申请完成后自动开始";
  }
  elements.gate.textContent = state.businessGate?.allowed ? (reportType === "trade-audit" ? "✓ 本轮任务匹配" : "✓ 查询结果匹配") : "待查询后核对";
  elements.gate.className = state.businessGate?.allowed ? "status-positive" : "";
  updateButtons();
  renderResult(state.status, state.error, submitted, downloadRequested);
};

const transition = async (event) => {
  if (!state) return;
  const { month, status } = event;
  if (month) state.currentMonth = month;
  state.stage = status || "RUNNING";
  if (["WAITING_FOR_SLOT", "WAITING_GENERATION", "ALL_MONTHS_SUBMITTED", "DOWNLOAD_REQUESTS_SENT"].includes(status)) {
    state.status = status;
  } else if (["SETTING_DATE", "STARTING_QUERY", "QUERYING", "QUERY_READY", "SUBMITTING", "SUBMITTED", "NO_DATA", "UNKNOWN", "FAILED", "DOWNLOAD_REQUESTED", "DOWNLOAD_COMPLETED", "OPENING_DOWNLOAD_LIST"].includes(status)) {
    state.status = ["DOWNLOAD_REQUESTED", "DOWNLOAD_COMPLETED", "OPENING_DOWNLOAD_LIST"].includes(status) ? "DOWNLOADING" : "RUNNING";
  } else {
    state.status = status || state.status || "RUNNING";
  }
  if (month && ["DOWNLOAD_REQUESTED", "DOWNLOAD_COMPLETED"].includes(status)) {
    state.months[month] = { ...(state.months[month] || {}), downloadStatus: status === "DOWNLOAD_COMPLETED" ? "COMPLETED" : "REQUESTED",
      downloadedFileName: event.fileName, downloadId: event.downloadId ?? null,
      downloadedAt: status === "DOWNLOAD_COMPLETED" ? new Date().toISOString() : null };
  } else if (month && state.months[month]) {
    state.months[month] = { ...state.months[month], ...event };
  }
  const messages = {
    SETTING_DATE: `${month}：设置${reportType === "trade-audit" ? "交易日期" : "清算时间"}。`,
    STARTING_QUERY: `${month}：正在启动查询。`,
    QUERYING: `${month}：查询已触发，等待结果。`,
    QUERY_READY: `${month}：查询结果已更新并稳定。`,
    SUBMITTING: `${month}：查询完成，正在申请 XLSX。`,
    WAITING_FOR_SLOT: event.pending === undefined
      ? `${month}：服务器限流（第 ${event.attempt} 次），最多等待 ${Math.ceil(event.retryInMs / 1000)} 秒${reportType === "account-detail" ? "；通过暂存接口检查本轮任务进度后重试" : "，稍后重试当前月"}。`
      : `${month}：等待申请名额，暂存接口显示本轮 ${event.pending} 个文件处理中、${event.generated} 个已生成；不打开下载暂存列表。`,
    NO_DATA: `${month}：明确返回无数据，跳过空文件。`,
    SUBMITTED: `${month}：申请已被服务器接受。`,
    WAITING_GENERATION: event.listStatus === "api"
      ? `暂存接口已匹配本轮 ${event.found ?? 0} / ${event.expected ?? 0} 个任务，${event.ready ?? 0} 个已确认生成成功；继续通过接口检查，不打开下载暂存列表。`
      : `已识别本轮 ${event.found ?? 0} / ${event.expected ?? 0} 个任务，${event.ready ?? 0} 个已生成且尚未下载；列表状态 ${event.listStatus || "unknown"}，当前页读到 ${event.parsedRows ?? 0} 行；过滤：文件名或商户号 ${event.rejected?.fileName ?? 0}，时间格式 ${event.rejected?.createdAt ?? 0}，非本轮任务 ${event.rejected?.beforeRun ?? 0}。稍后重开列表更新状态。`,
    DOWNLOAD_REQUESTED: `${month || "本轮任务"}：已通过行内检查并触发下载。`,
    DOWNLOAD_COMPLETED: `${month || "本轮任务"}：Chrome 已确认文件下载完成，立即继续下载已生成文件。`,
    DOWNLOAD_REQUESTS_SENT: "本轮所有文件均已由 Chrome 确认下载完成。"
  };
  if (messages[status]) appendLog(messages[status]);
  if (status === "WAITING_GENERATION") {
    const seconds = Math.floor((event.waitedMs || 0) / 1000);
    state.stage = event.listStatus === "api"
      ? `等待服务器生成：已等待 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒，剩余 ${event.remaining ?? event.expected ?? 0} 个任务未确认成功；约每 10 秒查询一次接口，可暂停或停止。`
      : `等待服务器生成：已等待 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒，剩余 ${event.remaining ?? event.expected ?? 0} 个文件未下载；约每 10 秒检查一次，可暂停或停止。`;
  }
  renderState();
  await saveState();
};

const checkpoint = async () => {
  if (stopRequested) throw new Error("STOPPED_BY_USER");
  if (paused) {
    state.status = "PAUSED";
    state.stage = "已暂停";
    renderState();
    await saveState();
  }
  while (paused && !stopRequested) await sleep(250);
  if (stopRequested) throw new Error("STOPPED_BY_USER");
  if (state.status === "PAUSED") {
    state.status = "RUNNING";
    state.stage = "恢复运行";
    renderState();
    await saveState();
  }
};

const waitForTab = async (predicate, timeoutMs = 25000) => {
  const deadline = activeNow() + timeoutMs;
  let last = null;
  while (activeNow() < deadline) {
    await checkpoint();
    last = await chrome.tabs.get(tabId).catch(() => null);
    if (last && predicate(last)) return last;
    await sleep(350);
  }
  throw new Error(`等待目标页面超时。${last?.url ? ` 当前地址：${safeUrlForStorage(last.url)}` : ""}`);
};

const verifyCurrentSession = async () => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url) throw new Error("当前银联商务标签页不可用。");
  let url;
  try { url = new URL(tab.url); } catch { throw new Error("当前标签页地址无法识别。"); }
  if (url.origin !== `https://${SITE_CONFIG.host}` || !url.pathname.startsWith(`${SITE_CONFIG.portalRoot}/`)) {
    throw new Error("请在已登录的银联商务门户标签页启动导出。");
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (config) => globalThis.__chinaumsAssistantScan?.(config) || null,
    args: [scannerConfig]
  });
  const snapshot = results[0]?.result;
  const authentication = snapshot && globalThis.CHINAUMS_AUTH.classify(
    snapshot.url,
    [snapshot],
    snapshot.mainNavigation || [],
    snapshot.businessEntries || []
  );
  if (!snapshot || snapshot.isTopFrame !== true || authentication?.status !== "logged_in" || authentication.confidence !== "high") {
    throw new Error("当前门户登录状态未达到高置信度；不会查询或申请导出。");
  }
  return {
    allowed: false,
    merchantNo: null,
    source: "awaiting-query-result",
    authentication
  };
};

const currentFrameId = async (reportType, targetTabId = tabId) => {
  const results = await chrome.scripting.executeScript({
    target: { tabId: targetTabId, allFrames: true },
    func: (routes) => ({
      pathname: location.pathname,
      hash: location.hash,
      isTopFrame: window.top === window,
      isReportFrame: routes.reportType === "account-detail"
        ? window.top === window && location.pathname === routes.accountDetailPath
        : location.pathname.replace(/\/+$/, "") === routes.frontendRoot && location.hash.includes("/auditOfTrade2026")
    }),
    args: [{
      reportType,
      accountDetailPath: SITE_CONFIG.reportRoutes.accountDetail,
      frontendRoot: SITE_CONFIG.frontendRoot
    }]
  });
  const match = results.find((item) => item.result?.isReportFrame === true);
  return match?.frameId ?? null;
};

const waitForDownload = async ({ fileName, requestedAt }) => {
  if (!chrome.downloads?.search) throw new Error("下载确认权限不可用，请重新加载扩展并允许 downloads 权限。");
  const escapedStem = fileName.replace(/\.xlsx$/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filenameRegex = `(?:^|[/\\\\])${escapedStem}(?: \\(\\d+\\))?\\.xlsx$`;
  const deadline = activeNow() + 5 * 60 * 1000;
  while (activeNow() < deadline) {
    await checkpoint();
    const items = await chrome.downloads.search({ startedAfter: requestedAt, filenameRegex });
    if (items.length > 1) throw new Error(`文件 ${fileName} 对应多个新下载记录，无法唯一确认。`);
    const item = items[0];
    if (item?.state === "interrupted") throw new Error(`文件 ${fileName} 下载中断：${item.error || "未知原因"}。`);
    if (item?.state === "complete") {
      if (item.exists === false) throw new Error(`文件 ${fileName} 已被删除，不能记为下载完成。`);
      return { status: "download_completed", downloadId: item.id };
    }
    await sleep(500);
  }
  throw new Error(`文件 ${fileName} 在 5 分钟内未确认下载完成；停止后续下载，请检查 Chrome 下载记录。`);
};

const injectedAdapters = new Set();
const invoke = async (reportType, operation, args = {}, targetTabId = tabId) => {
  await checkpoint();
  if (operation === "confirmDownload") return waitForDownload(args);
  const defaultLimit = reportType === "trade-audit" && operation === "setDateRange" ? 60000 : 15000;
  const operationDeadline = Math.min(Date.now() + defaultLimit, args.operationDeadline ?? Infinity);
  const checkDeadline = () => {
    if (Date.now() >= operationDeadline) throw new Error(`页面操作“${operation}”已超过截止时间。`);
  };
  checkDeadline();
  return withTimeout((async () => {
    const frameId = await currentFrameId(reportType, targetTabId);
    checkDeadline();
    if (frameId === null) return { status: "wrong_page", reason: "未找到当前报表页面或业务 frame。" };
    const file = reportType === "account-detail" ? "account-detail.js" : "trade-audit.js";
    const globalName = reportType === "account-detail"
      ? "__chinaumsAccountDetailAdapter"
      : "__chinaumsTradeAuditAdapter";
    const world = reportType === "trade-audit" ? "MAIN" : "ISOLATED";
    const loaded = await chrome.scripting.executeScript({
      target: { tabId: targetTabId, frameIds: [frameId] }, world,
      func: (name) => typeof globalThis[name] === "function",
      args: [globalName]
    });
    checkDeadline();
    const injectionKey = `${targetTabId}:${frameId}:${file}`;
    if (!injectedAdapters.has(injectionKey) || loaded[0]?.result !== true) {
      await chrome.scripting.executeScript({ target: { tabId: targetTabId, frameIds: [frameId] }, world, files: [file] });
      injectedAdapters.add(injectionKey);
    }
    checkDeadline();
    const result = await chrome.scripting.executeScript({
      target: { tabId: targetTabId, frameIds: [frameId] }, world,
      func: async (name, action, actionArgs) => {
        if (Date.now() >= actionArgs.operationDeadline) throw new Error("页面操作已超过截止时间，未执行。");
        const adapter = globalThis[name];
        if (typeof adapter !== "function") return { status: "adapter_missing" };
        return await adapter(action, actionArgs);
      },
      args: [globalName, operation, { ...args, operationDeadline }]
    });
    return result[0]?.result || { status: "unknown" };
  })(), Math.max(0, operationDeadline - Date.now()), operation);
};

const navigateToReport = async () => {
  const url = new URL((await chrome.tabs.get(tabId)).url);
  const targetUrl = `https://${SITE_CONFIG.host}${reportType === "trade-audit" ? SITE_CONFIG.reportRoutes.tradeAuditPortal : SITE_CONFIG.reportRoutes.accountDetail}`;
  await chrome.tabs.update(tabId, { active: true, ...(url.href !== targetUrl ? { url: targetUrl } : {}) });
  await waitForTab((tab) => {
    try {
      const current = new URL(tab.url);
      return current.origin === `https://${SITE_CONFIG.host}` && current.href === targetUrl && tab.status === "complete";
    } catch {
      return false;
    }
  });
  const deadline = activeNow() + 30000;
  let inspection;
  while (activeNow() < deadline) {
    inspection = await invoke(reportType, "inspect", {});
    if (inspection?.downloadListOpen === true) {
      const closed = await invoke(reportType, "closeDownloadList", {});
      if (closed?.status !== "closed") {
        throw new Error("检测到原先打开的下载暂存列表，但无法安全关闭；尚未开始本轮查询。");
      }
      appendLog("已关闭原先打开的下载暂存列表，准备继续月度查询。");
      await sleep(200);
      continue;
    }
    if (inspection?.status === "ready" && inspection.hasQuery) return;
    await sleep(400);
  }
  throw new Error(`${reportType === "trade-audit" ? "以旧换新采集2026" : "对账明细"}页控件未就绪（${inspection?.status || "无返回状态"}）：${inspection?.reason || "未找到可用查询入口"}`);
};

const parsePortalTimestamp = (value) => {
  const match = String(value || "").match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (!match) return Number.NaN;
  return new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6])
  ).getTime();
};

const reconcileUnknown = async ({ attemptedAt, sourceTabId = tabId, targetMerchantNo, gate, baselineRows = [] }) => {
  const merchantNo = normalize(targetMerchantNo);
  const attemptedAtMs = new Date(attemptedAt).getTime();
  if (!merchantNo || !Number.isFinite(attemptedAtMs)) return { status: "unknown", reason: "缺少申请时间或已确认商户号，无法安全核对。" };
  const invokeSource = (operation, args = {}) => invoke(reportType, operation, args, sourceTabId);

  if (["account-detail", "trade-audit"].includes(reportType)) {
    const previousIds = new Set((Array.isArray(baselineRows) ? baselineRows : [])
      .map((row) => String(row?.id || "")).filter(Boolean));
    if (previousIds.size !== baselineRows.length) {
      return { status: "unknown", reason: "申请前暂存任务基线缺失或身份重复，不能安全核对。" };
    }
    const deadline = activeNow() + 15000;
    while (activeNow() < deadline) {
      await checkpoint();
      let snapshot;
      try {
        snapshot = await invokeSource("snapshotExportTasks", {
          operationDeadline: Date.now() + Math.max(0, deadline - activeNow())
        });
      } catch (error) {
        if (error?.message === "STOPPED_BY_USER") throw error;
        snapshot = { status: "unknown", reason: error?.message || "暂存接口读取失败" };
      }
      if (snapshot?.status === "found" && Array.isArray(snapshot.rows)) {
        const added = snapshot.rows.filter((row) => !previousIds.has(String(row.id || "")));
        if (added.length > 1) {
          return { status: "unknown", reason: "提交后出现多个新暂存任务，无法唯一证明本次申请归属；不自动重提。" };
        }
        if (added.length === 1) {
          const row = added[0];
          const createdAtMs = parsePortalTimestamp(row.createdAt);
          const accountMatch = String(row.fileName || "").match(/^([A-Z0-9]+)_MX_\d{14}(?:_[^.]*)?\.xlsx$/i);
          const tradeMatch = String(row.fileName || "").match(/^MER_([A-Z0-9]+)_\d{14}_yjhx\.xlsx$/i);
          const fileMatch = reportType === "trade-audit" ? tradeMatch : accountMatch;
          const idValid = reportType === "trade-audit"
            ? /^\d{32}$/.test(String(row.id || ""))
            : /^[0-9a-f]{32}$/i.test(String(row.id || ""));
          const alreadyBound = Object.values(state?.months || {}).some((month) =>
            month.remoteTaskId === row.id || month.remoteFileName === row.fileName
          );
          if (!idValid || !fileMatch || normalize(fileMatch[1]) !== merchantNo || !Number.isFinite(createdAtMs) ||
            createdAtMs < attemptedAtMs - 2000 || createdAtMs > Date.now() + 2000 || alreadyBound) {
            return { status: "unknown", reason: "唯一新增暂存任务的商户、时间或身份校验未通过；不自动重提。" };
          }
          return {
            status: "accepted",
            taskId: String(row.id),
            fileName: row.fileName,
            createdAt: row.createdAt,
            merchantNo
          };
        }
      } else if (snapshot?.status && !["unknown", "loading", "empty"].includes(snapshot.status)) {
        return { status: "unknown", reason: snapshot.reason || snapshot.status };
      }
      await sleep(Math.max(0, Math.min(500, deadline - activeNow())));
    }
    return { status: "unknown", reason: "15秒内未找到唯一新增暂存任务；不自动重提。" };
  }
};

const closeExistingSubmitNotice = async () => {
  const notice = await invoke(reportType, "classifySubmit", {});
  if (!new Set(["accepted", "throttled", "failed"]).has(notice?.status)) return false;
  let closed = { status: "unknown" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    closed = await invoke(reportType, "closeSubmitDialog", {});
    if (closed?.status === "closed") return true;
    await sleep(350);
  }
  throw new Error(`页面上已有提交提示，关闭失败（${closed?.reason || closed?.status || "未知状态"}）。`);
};

const run = async () => {
  if (!["account-detail", "trade-audit"].includes(reportType) || !Number.isInteger(tabId) || tabId <= 0 || !SITE_CONFIG) throw new Error("导出参数无效。");
  if (reportType === "trade-audit" && new Date().getFullYear() !== 2026) {
    throw new Error("以旧换新采集当前仅适配 2026 页面。");
  }
  const months = globalThis.CHINAUMS_MONTHLY_RUNNER.yearToDateMonths();
  const monthKeys = months.map((month) => month.key);
  const stored = await chrome.storage.local.get(RUN_KEY);
  const prior = stored[RUN_KEY];
  const priorIsActive = prior && ["GATING", "RUNNING", "WAITING_FOR_SLOT", "WAITING_GENERATION", "PAUSED", "SUBMITTING", "ALL_MONTHS_SUBMITTED", "ALL_READY", "DOWNLOADING"].includes(prior.status);
  const currentRunnerTab = await chrome.tabs.getCurrent().catch(() => null);
  const priorRunnerTab = Number.isInteger(prior?.runnerTabId)
    ? await chrome.tabs.get(prior.runnerTabId).catch(() => null)
    : null;
  const priorRunnerIsLive = Boolean(
    priorIsActive && priorRunnerTab?.url?.split("?")[0] === chrome.runtime.getURL("export.html") &&
    priorRunnerTab.id !== currentRunnerTab?.id
  );
  if (priorRunnerIsLive) {
    await chrome.tabs.remove(priorRunnerTab.id);
  }
  const now = new Date().toISOString();
  const archivePriorRun = async () => {
    if (!prior?.runId) return;
    const archiveStorage = await chrome.storage.local.get(ARCHIVE_KEY);
    const archivedRuns = Array.isArray(archiveStorage[ARCHIVE_KEY]) ? archiveStorage[ARCHIVE_KEY] : [];
    if (archivedRuns.some((item) => item.runId && item.runId === prior.runId)) return;
    archivedRuns.push({
      ...prior,
      archivedAt: now,
      archiveReason: "启动新的年初至今导出；旧运行保留在归档中。"
    });
    await chrome.storage.local.set({ [ARCHIVE_KEY]: archivedRuns.slice(-20) });
  };
  await archivePriorRun();
  state = {
    schemaVersion: 1,
    runId: `${reportType}-ytd-${now.replace(/[:.]/g, "-")}`,
    tabId,
    runnerTabId: currentRunnerTab?.id ?? null,
    merchantNo: null,
    reportType,
    startedAt: now,
    stage: "检查当前登录会话",
    status: "GATING",
    businessGate: { allowed: false, merchantNo: null },
    monthOrder: monthKeys,
    months: Object.fromEntries(months.map((month) => [month.key, { status: "PENDING", start: month.start, end: month.end }])),
    logs: []
  };
  elements.target.textContent = `当前商户：查询后识别　导出月份：${state.monthOrder[0]} 至 ${state.monthOrder.at(-1)}`;
  elements.close.disabled = true;
  await saveState();

  appendLog("下载流程版本：2026-10-05-trade-startup-inspect。正在确认当前银联商务门户仍为高置信度登录；不会打开商户准备页或切换商户。");
  const gate = await verifyCurrentSession();
  const recordMerchant = async (merchantNo, source) => {
    const changed = state.merchantNo !== merchantNo;
    Object.assign(gate, { allowed: true, merchantNo, source });
    state.merchantNo = merchantNo;
    state.businessGate = { allowed: true, merchantNo, source };
    elements.target.textContent = `当前商户号：${merchantNo}　导出月份：${state.monthOrder[0]} 至 ${state.monthOrder.at(-1)}`;
    if (changed) appendLog(`已从${source === "download-task" ? "本轮暂存任务" : "查询结果"}识别当前商户号：${merchantNo}。`);
    renderState();
    await saveState();
  };
  state.businessGate = { allowed: false, merchantNo: null, source: "awaiting-query-result" };
  elements.gate.textContent = "待查询后核对";
  elements.gate.className = "";
  appendLog(`本轮报表：${reportType === "trade-audit" ? "以旧换新" : "对账明细"}。`);
  appendLog("当前会话已登录。将沿用当前商户，从今年 1 月开始逐月查询；首个有数据的月份会识别商户号。");
  if (prior?.runId) appendLog(`上次运行（${prior.runId}）已留档；本轮从 ${monthKeys[0]} 重新开始，不会漏掉月份。`);
  await saveState();

  await navigateToReport();
  if (await closeExistingSubmitNotice()) appendLog("已关闭上次遗留的申请提示，开始本轮月份查询。");
  if (months.length) {
    await globalThis.CHINAUMS_MONTHLY_RUNNER.run({
      months,
      reportType,
      invoke: (operation, args) => invoke(reportType, operation, args),
      gate,
      checkpoint,
      now: activeNow,
      sleep,
      transition,
      reconcileUnknown,
      onMerchantVerified: (merchantNo, source = "query-result") => recordMerchant(merchantNo, source)
    });
  }

  const submittedMonths = months
    .filter((month) => state.months[month.key]?.status === "SUBMITTED")
    .map((month) => ({
      month: month.key,
      remoteFileName: state.months[month.key].remoteFileName || null,
      remoteTaskId: state.months[month.key].remoteTaskId || null,
      submittedAt: state.months[month.key].submittedAt || state.months[month.key].attemptedAt,
      downloadedFileName: state.months[month.key].downloadStatus === "COMPLETED"
        ? state.months[month.key].downloadedFileName : null
    }));
  state.status = "ALL_MONTHS_SUBMITTED";
  state.stage = "所有月份申请完成，准备等待文件生成并下载";
  await saveState();

  if (submittedMonths.length) {
    if (!gate.allowed && reportType !== "trade-audit") throw new Error("尚无查询结果确认当前商户号，不能进入下载阶段。");
    const merchantNo = normalize(state.merchantNo || gate.merchantNo);
    if (reportType !== "trade-audit" && (!merchantNo || merchantNo !== normalize(gate.merchantNo))) throw new Error("下载前商户号复核未通过，不能打开或下载暂存文件。");
    await globalThis.CHINAUMS_DOWNLOAD_RUNNER.run({
      invoke: (operation, args) => invoke(reportType, operation, args),
      reportType,
      merchantNo,
      onMerchantIdentified: (merchantNo) => recordMerchant(merchantNo, "download-task"),
      startedAt: state.startedAt,
      submittedMonths,
      gate,
      checkpoint,
      now: activeNow,
      sleep,
      transition
    });
  }
  state.status = "COMPLETED";
  state.stage = submittedMonths.length ? "本轮文件已完成下载" : "本轮没有需要下载的文件";
  appendLog(submittedMonths.length
    ? `导出流程结束。Chrome 已确认本轮所有文件下载完成；${reportType === "trade-audit" ? "以旧换新" : "对账明细"}最终下载未打开下载暂存列表。`
    : "导出流程结束。本轮月份均无数据，没有提交导出申请。");
  renderState();
  await saveState();
};

elements.pause.addEventListener("click", () => {
  if (!paused) pausedAt = Date.now();
  paused = true;
  elements.pause.disabled = true;
  elements.resume.disabled = false;
  if (state) {
    state.status = "PAUSED";
    state.stage = "暂停中";
    renderState();
    saveState();
  }
});

elements.resume.addEventListener("click", () => {
  finishPause();
  paused = false;
  elements.resume.disabled = true;
  renderState();
});

elements.stop.addEventListener("click", () => {
  stopRequested = true;
  finishPause();
  paused = false;
  elements.stop.disabled = true;
  elements.resume.disabled = true;
  appendLog("已请求停止。若服务器已接受的申请仍会留在远端暂存列表中。");
});

elements.close.addEventListener("click", () => window.close());

run().catch(async (error) => {
  const stopped = error?.message === "STOPPED_BY_USER";
  if (state) {
    state.status = stopped ? "STOPPED" : "BLOCKED";
    state.stage = stopped ? "用户停止" : "安全停止";
    state.error = stopped ? "用户停止了当前自动流程。已提交给服务器的任务不会撤销。" : error?.message || "运行失败。";
    appendLog(stopped ? "流程已停止；服务器已接受的申请保留在远端。" : `流程安全停止：${state.error}`);
    renderState();
    await saveState();
  } else {
    elements.status.textContent = "无法启动";
    elements.stage.textContent = "参数/登录检查";
    renderResult("BLOCKED", error?.message || "导出启动失败。");
    elements.close.disabled = false;
  }
});

