const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const trade = process.argv.includes("trade-audit");
const elements = new Map();
const element = (selector) => {
  if (!elements.has(selector)) elements.set(selector, {
    addEventListener() {}, append() {}, scrollIntoView() {}
  });
  return elements.get(selector);
};
let complete;
const completed = new Promise((resolve) => { complete = resolve; });
const context = vm.createContext({
  URL, URLSearchParams, Date, Intl, location: { search: trade ? "?tabId=1&reportType=trade-audit" : "?tabId=1" },
  window: { setTimeout, clearTimeout },
  document: { querySelector: element, createElement: element }
});
vm.runInContext(fs.readFileSync(`${__dirname}/site-config.js`, "utf8"), context);
vm.runInContext(fs.readFileSync(`${__dirname}/monthly-runner.js`, "utf8"), context);
const months = context.CHINAUMS_MONTHLY_RUNNER.yearToDateMonths();
const merchantNo = "89813014812B1L3";
const prior = {
  runId: "existing-run", status: process.argv[2] || "BLOCKED", reportType: "account-detail", tabId: process.argv[2] ? 99 : 1,
  runnerTabId: 8, merchantNo, businessGate: { allowed: true, merchantNo }, startedAt: "2026-01-01T00:00:00.000Z",
  error: "暂存列表关闭结果无法确认；已停止自动下载。", logs: [],
  monthOrder: months.map((month) => month.key),
  months: Object.fromEntries(months.map((month) => [month.key, { status: "SUBMITTED", submittedAt: new Date().toISOString() }]))
};
prior.months[months[0].key].downloadStatus = "REQUESTED";
prior.months[months[0].key].downloadedFileName = "already-clicked.xlsx";
context.CHINAUMS_AUTH = { classify: () => ({ status: "logged_in", confidence: "high" }) };
context.CHINAUMS_MONTHLY_RUNNER = {
  yearToDateMonths: context.CHINAUMS_MONTHLY_RUNNER.yearToDateMonths,
  run: async (args) => {
    assert.equal(args.months.length, months.length);
    assert.equal(args.targetMerchantNo, null);
    assert(Object.values(latest.months).every((month) => month.status === "PENDING"));
    if (trade) assert.equal(args.merchantFromTasks, true);
    else await args.onMerchantVerified(merchantNo);
    for (const month of args.months) await args.transition({ month: month.key, status: "SUBMITTED", submittedAt: new Date().toISOString() });
  }
};
let downloadRuns = 0;
let adapterInjections = 0;
let latest;
let archived;
const closedTabs = [];
context.CHINAUMS_DOWNLOAD_RUNNER = { run: async (args) => {
  downloadRuns += 1;
  if (trade) await args.onMerchantIdentified(merchantNo);

  assert.notEqual(args.startedAt, prior.startedAt);
  assert.equal(args.submittedMonths.length, months.length);
  assert.equal(args.submittedMonths[0].downloadedFileName, null, "legacy click records must not count as completed");
  await args.transition({ status: "WAITING_GENERATION", found: 0, expected: months.length, ready: 0 });
  await args.transition({ status: "WAITING_GENERATION", found: 0, expected: months.length, ready: 0 });
} };
const tab = { id: 1, url: trade ? "https://service.chinaums.com" + context.CHINAUMS_SITE_CONFIG.reportRoutes.tradeAuditPortal : "https://service.chinaums.com/uisportal/accountCheckDetailQry/toDetail", status: "complete" };
context.chrome = {
  tabs: { get: async (id) => id === 8 ? { id: 8, url: "chrome-extension://test/export.html" } : tab,
    getCurrent: async () => ({ id: 2 }), remove: async (id) => { closedTabs.push(id); } },
  runtime: { getURL: (path) => `chrome-extension://test/${path}` },
  storage: { local: {
    get: async () => ({ activeExportRun: prior }),
    set: async (value) => {
      if (value.archivedExportRuns) archived = value.archivedExportRuns;
      if (value.activeExportRun) latest = value.activeExportRun;
      if (["COMPLETED", "BLOCKED"].includes(value.activeExportRun?.status)) complete(value.activeExportRun);
    }
  } },
  scripting: { executeScript: async ({ args, files }) => {
    if (files) {
      if (files.includes(trade ? "trade-audit.js" : "account-detail.js")) adapterInjections += 1;
      return [];
    }
    if (args[0]?.reportType) return [{ frameId: 0, result: { isReportFrame: true } }];
    if (typeof args[0] === "object") return [{ result: { isTopFrame: true, url: tab.url } }];
    if (args.length === 1) return [{ result: true }];
    assert(!["setDateRange", "query", "submitExport"].includes(args[1]));
    if (trade && args[1] === "openDownloadList") return [{result: {status: "clicked"}}];
    if (trade && args[1] === "parseDownloadTasks") {
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
      return [{result: {status: "found", rows: [{createdAt: `${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)} ${stamp.slice(8,10)}:${stamp.slice(10,12)}:${stamp.slice(12,14)}`, fileName: `MER_${merchantNo}_${stamp}_yjhx.xlsx`}]}}];
    }
    return [{ result: args[1] === "inspect" ? { status: "ready", hasQuery: true, hasDownloadList: true }
      : { status: args[1] === "closeDownloadList" ? "already_closed" : "unknown" } }];
  } }
};
vm.runInContext(fs.readFileSync(`${__dirname}/export-runner.js`, "utf8"), context);
const timer = setTimeout(() => { console.error("FAIL: resume did not finish"); process.exitCode = 1; }, 1000);
completed.then((state) => {
  assert.equal(state.status, "COMPLETED", state.error);
  assert.notEqual(state.runId, prior.runId);
  assert.equal(archived[0].runId, prior.runId);
  if (prior.status === "WAITING_GENERATION") assert.deepEqual(closedTabs, [8]);
  assert.equal(downloadRuns, 1);
  assert.equal(state.merchantNo, merchantNo);
  assert(elements.get("#export-target").textContent.includes(merchantNo), "both reports must display the identified merchant");
  assert.equal(adapterInjections, 1, "replace a preexisting adapter once without resetting it for every operation");
  assert.equal(state.logs.filter((message) => message.startsWith("已识别本轮")).length, 1,
    "unchanged polling results must not spam the log");
  console.log(`PASS: ${prior.status} starts a fresh run and archives old state`);
}).catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => clearTimeout(timer));
