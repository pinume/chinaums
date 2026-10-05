const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

let opened = false;
let closeClicks = 0;
let snapshotCalls = 0;

class Element {
  constructor(text = "", query = () => [], click = () => {}) {
    this.text = text;
    this.query = query;
    this.click = click;
    this.parentElement = null;
    this.classList = { contains: () => false };
  }
  get innerText() { return typeof this.text === "function" ? this.text() : this.text; }
  get textContent() { return this.innerText; }
  getClientRects() { return [1]; }
  querySelectorAll(selector) { return this.query(selector); }
  querySelector(selector) { return this.query(selector)[0] || null; }
  getAttribute() { return null; }
  closest() { return null; }
  contains(element) { return element !== this; }
}

const form = new Element("", (selector) =>
  ["[name=\"settDateBegin\"]", "[name=\"settDateEnd\"]"].includes(selector) ? [new Element()] : []
);
const close = new Element("×", undefined, () => {
  closeClicks += 1;
  opened = false;
});
const header = new Element("", (selector) => selector === "th,td"
  ? ["请求时间", "文件名", "下载状态", "操作"].map((text) => new Element(text))
  : []);
const table = new Element("", (selector) => selector === "tr" ? [header] : []);
const dialog = new Element("", (selector) => selector === "table#downloadList" ? [table]
  : selector === ".placeLoad-header .close-Load" ? [close] : []);
const wrapper = new Element();
table.parentElement = dialog;
dialog.parentElement = wrapper;

const merchantNo = "89813015722APT1";
const snapshotRows = [
  {
    export_id: "remote-1",
    file_name: `${merchantNo}_MX_20261005120001.xlsx`,
    apply_date: "2026/10/05 12:00:01",
    task_status: "10"
  },
  {
    export_id: "remote-2",
    file_name: `${merchantNo}_MX_20261005120002.xlsx`,
    apply_date: "2026/10/05 12:00:02",
    task_status: "30"
  }
];

const context = vm.createContext({
  Element,
  Date,
  AbortController,
  setTimeout,
  clearTimeout,
  location: { hostname: "service.chinaums.com", pathname: "/uisportal/accountCheckDetailQry/toDetail" },
  getComputedStyle: (element) => ({
    display: "block",
    visibility: "visible",
    opacity: element === wrapper && !opened ? "0" : "1"
  }),
  document: {
    body: new Element(),
    documentElement: new Element(),
    querySelectorAll(selector) {
      if (selector === "form") return [form];
      if (selector === ".loadSave-row") return [dialog];
      return [];
    }
  },
  fetch: async () => {
    snapshotCalls += 1;
    return {
      ok: true,
      json: async () => ({
        respCode: "000000",
        list: { content: snapshotRows, totalPages: 1, totalElements: snapshotRows.length }
      })
    };
  }
});
vm.runInContext(fs.readFileSync(`${__dirname}/account-detail.js`, "utf8"), context);

(async () => {
  const adapter = context.__chinaumsAccountDetailAdapter;

  let inspection = await adapter("inspect");
  assert.equal(inspection.status, "ready");
  assert.equal(inspection.downloadListOpen, false);

  opened = true;
  inspection = await adapter("inspect");
  assert.equal(inspection.downloadListOpen, true);
  assert.equal((await adapter("closeDownloadList")).status, "closed");
  assert.equal(closeClicks, 1);
  assert.equal((await adapter("inspect")).downloadListOpen, false);
  assert.equal((await adapter("closeDownloadList")).status, "already_closed");
  assert.equal(closeClicks, 1);

  const snapshot = await adapter("snapshotExportTasks", { taskIds: ["remote-1", "remote-2"] });
  assert.equal(snapshotCalls, 1);
  assert.deepEqual(Array.from(snapshot.rows, (row) => row.statusCode), ["pending", "ready"]);
  assert.deepEqual(Array.from(snapshot.rows, (row) => row.taskStatus), ["10", "30"]);

  for (const operation of [
    "openDownloadList", "parseDownloadTasks", "setDownloadPageSize",
    "nextDownloadPage", "selectDownloadPage", "downloadTask"
  ]) {
    assert.equal((await adapter(operation, {})).status, "unknown_operation",
      `${operation} should stay deleted after direct-download migration`);
  }

  console.log("PASS: account startup only closes a truly open old list, task snapshots use the API, and removed list operations stay dead");
})().catch((error) => { console.error(error); process.exitCode = 1; });
