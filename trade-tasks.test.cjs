const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor(text = "") {
    this.textContent = text;
    this.innerText = text;
    this.disabled = false;
    this.classList = { contains: () => false };
    this.children = [];
  }
  getClientRects() { return [1]; }
  querySelectorAll() { return []; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getAttribute() { return null; }
  closest(selector) {
    return selector === ".el-dialog__wrapper" ? this.wrapper || null : null;
  }
}

let component = { $options: { name: "ElDialog" }, visible: true };
const table = new Element();
table.__vue__ = { $parent: { $options: { name: "table" }, $axiosApi: { axiosPromisePara: async () => { throw new Error("not used"); } } } };
let closeWorks = true;
let closeClicks = 0;
const close = new Element("×");
close.click = () => {
  closeClicks += 1;
  if (closeWorks) component.visible = false;
};
const title = new Element("下载暂存列表");
const dialog = new Element();
const wrapper = new Element();
wrapper.__vue__ = { $parent: component };
dialog.wrapper = wrapper;
dialog.querySelectorAll = (selector) => selector === ".el-dialog__headerbtn" ? [close] : [];
dialog.querySelector = (selector) => selector === ".el-dialog__title" ? title : null;

class Observer {
  observe() {}
  disconnect() {}
}

const context = vm.createContext({
  Element,
  Date,
  MutationObserver: Observer,
  setTimeout: (fn) => { fn(); return 1; },
  clearTimeout: () => {},
  location: { hostname: "service.chinaums.com", pathname: "/uisportalfront/", hash: "#/auditOfTrade2026" },
  getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
  document: {
    documentElement: new Element(),
    body: new Element("根据查询条件共查询到 1 条记录"),
    querySelectorAll(selector) {
      if (selector === ".el-table") return [table];
      if (selector === ".el-dialog") return [dialog];
      return [];
    }
  }
});
vm.runInContext(fs.readFileSync(`${__dirname}/trade-audit.js`, "utf8"), context);

(async () => {
  const adapter = context.__chinaumsTradeAuditAdapter;

  let inspection = await adapter("inspect");
  assert.equal(inspection.status, "ready", "date/query/export/list controls are no longer required for report readiness");
  assert.equal(inspection.hasQuery, true);
  assert.equal(inspection.downloadListOpen, true);

  let result = await adapter("closeDownloadList", {});
  assert.equal(result.status, "closed");
  assert.equal(closeClicks, 1);
  inspection = await adapter("inspect");
  assert.equal(inspection.downloadListOpen, false, "closed Vue component must ignore residual dialog DOM");
  assert.equal((await adapter("closeDownloadList", {})).status, "already_closed");
  assert.equal(closeClicks, 1);

  component = { $options: { name: "ElDialog" }, visible: true };
  wrapper.__vue__ = { $parent: component };
  closeWorks = false;
  result = await adapter("closeDownloadList", { operationDeadline: Date.now() + 1 });
  assert.equal(result.status, "blocked", "ignored close click must never claim the old list was closed");

  for (const operation of ["openDownloadList", "parseDownloadTasks", "nextDownloadPage", "selectDownloadPage", "downloadTask"]) {
    assert.equal((await adapter(operation, {})).status, "unknown_operation",
      `${operation} should stay deleted after direct download migration`);
  }

  console.log("PASS: trade startup detects only a truly open old list, closes it once, and keeps removed list operations dead");
})().catch((error) => { console.error(error); process.exitCode = 1; });
