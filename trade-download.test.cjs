const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
require("./download-runner.js");

const merchantNo = "89813014812B1L3";
const tasks = Array.from({ length: 12 }, (_, index) => ({
  id: String(index + 1).padStart(32, "0"),
  fileName: `MER_${merchantNo}_202609301813${String(index).padStart(2, "0")}_yjhx.xlsx`,
  statusCode: "ready",
  exportStatus: "02",
  exportStatusDesc: "成功"
}));
const mixed = process.argv.includes("mixed");
if (mixed) tasks[1].fileName = tasks[1].fileName.replace(merchantNo, "89813014812B06R");

async function checkRunner() {
  const requested = [];
  const completed = [];
  const calls = [];
  const result = globalThis.CHINAUMS_DOWNLOAD_RUNNER.run({
    reportType: "trade-audit",
    merchantNo: "",
    onMerchantIdentified: async (value) => assert.equal(value, merchantNo),
    startedAt: new Date(2026, 8, 30, 18, 13, 0, 500).toISOString(),
    submittedMonths: tasks.map((task, index) => ({
      month: `2026-${String(index + 1).padStart(2, "0")}`,
      submittedAt: new Date(2026, 8, 30, 18, 13, index, 500).toISOString(),
      remoteFileName: task.fileName,
      remoteTaskId: task.id
    })),
    gate: { allowed: true, merchantNo },
    checkpoint: async () => {},
    sleep: async () => {},
    transition: async (event) => {
      if (event.status === "DOWNLOAD_COMPLETED") completed.push(event.fileName);
    },
    invoke: async (operation, args = {}) => {
      calls.push(operation);
      if (operation === "snapshotExportTasks") {
        assert.equal(args.taskIds.length, 12);
        return { status: "found", rows: tasks };
      }
      if (operation === "downloadTaskDirect") {
        assert.equal(completed.length, requested.length, "downloads must be confirmed sequentially");
        const task = tasks[requested.length];
        assert.equal(args.taskId, task.id);
        assert.equal(args.fileName, task.fileName);
        assert.equal(args.targetMerchantNo, merchantNo);
        requested.push(args.fileName);
        return { status: "download_requested", downloadId: requested.length };
      }
      if (operation === "confirmDownload") {
        assert.equal(args.fileName, requested.at(-1));
        assert.equal(args.downloadId, requested.length);
        return { status: "download_completed", downloadId: requested.length };
      }
      throw new Error(`Unexpected operation: ${operation}`);
    }
  });

  if (mixed) {
    await assert.rejects(result, /多个商户/);
    assert.equal(requested.length, 0);
    return;
  }
  const rows = await result;
  assert.equal(rows.length, 12);
  assert.deepEqual(requested, tasks.map((task) => task.fileName));
  assert.deepEqual(completed, requested);
  for (const operation of ["openDownloadList", "parseDownloadTasks", "downloadTask", "closeDownloadList"]) {
    assert(!calls.includes(operation), `trade direct download must not call ${operation}`);
  }
}

async function checkAdapter() {
  class Element {
    constructor() { this.attrs = {}; this.removed = false; }
    getClientRects() { return [1]; }
    closest() { return null; }
    setAttribute(name, value) { this.attrs[name] = value; }
    remove() { this.removed = true; }
  }
  const appended = [];
  const body = new Element();
  body.append = (node) => appended.push(node);
  let token = "TEST_TOKEN";
  const context = vm.createContext({
    Element,
    Date,
    AbortController,
    encodeURIComponent,
    location: { protocol: "https:", hostname: "service.chinaums.com", pathname: "/uisportalfront/", hash: "#/auditOfTrade2026" },
    localStorage: { getItem: () => token },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    document: {
      body,
      documentElement: new Element(),
      querySelectorAll: () => [],
      createElement: (tag) => {
        assert.equal(tag, "iframe");
        return new Element();
      }
    },
    setTimeout: (fn, ms) => {
      assert.equal(ms, 60000);
      fn();
      return 1;
    },
    clearTimeout: () => {}
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/trade-audit.js`, "utf8"), context);
  const adapter = context.__chinaumsTradeAuditAdapter;
  const args = {
    gate: { allowed: true, merchantNo },
    targetMerchantNo: merchantNo,
    taskId: "20261005133941681550426941423616",
    fileName: `MER_${merchantNo}_20261005133941_yjhx.xlsx`
  };

  let response = await adapter("downloadTaskDirect", args);
  assert.equal(response.status, "download_requested");
  assert.equal(response.url, "https://service.chinaums.com/uisportal/api/uis-tradein-server/portal/yjhx/v3/downloadExportFile/20261005133941681550426941423616?userPortalToken=TEST_TOKEN");
  assert.equal(appended.length, 0, "adapter must not create an iframe");

  response = await adapter("downloadTaskDirect", { ...args, taskId: "bad-id" });
  assert.equal(response.status, "blocked");
  response = await adapter("downloadTaskDirect", { ...args, fileName: "MER_OTHER_20261005133941_yjhx.xlsx" });
  assert.equal(response.status, "blocked");
  token = "";
  response = await adapter("downloadTaskDirect", args);
  assert.equal(response.status, "blocked");
  assert.equal(appended.length, 0, "failed guards must not start another download request");
}

(async () => {
  await checkRunner();
  if (!mixed) await checkAdapter();
  console.log(mixed
    ? "PASS: mixed trade merchants stop before any direct download"
    : "PASS: trade downloads exact task IDs directly, sequentially confirms Chrome completion, and uses the captured endpoint");
})().catch((error) => { console.error(error); process.exitCode = 1; });
