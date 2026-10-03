const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

let opened = false;
let opens = 0;
let page = 1;
let size = 5;
let buttonDelay = 0;
const downloads = [];
const pageSizes = [];
const today = new Date();
const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
const dateText = `${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/${stamp.slice(6, 8)}`;
const merchantNo = "89813015722APT1";

class Element {
  constructor(text = "", query = () => [], click = () => {}) {
    this.text = text; this.query = query; this.click = click;
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

const rows = Array.from({ length: 35 }, (_, index) => {
  const fileName = `${merchantNo}_MX_${stamp}0000${String(35 - index).padStart(2, "0")}.xlsx`;
  const button = new Element("下载", undefined, () => {
    assert(!downloads.includes(fileName)); downloads.push(fileName);
  });
  Object.defineProperty(button, "disabled", { get: () => index === 0 && opens === 1 });
  const cells = [new Element(`${dateText} 00:00:${String(35 - index).padStart(2, "0")}`),
    new Element(fileName), new Element(() => button.disabled ? "排队中" : "已生成"), new Element("下载")];
  return new Element(() => cells.map((cell) => cell.innerText).join(" "),
    (selector) => selector === "th,td" || selector === "td" ? cells : selector.includes("div.pwedDown") ? [button] : []);
});
const select = new Element("5 20 50");
select.options = [5, 20, 50].map((number) => ({ text: String(number), value: String(number) }));
Object.defineProperty(select, "value", { get: () => String(size), set: (value) => { size = Number(value); } });
select.dispatchEvent = () => { pageSizes.push(size); page = 1; };
const navigation = [new Element("首页", undefined, () => { page = 1; }),
  new Element("上一页", undefined, () => { page -= 1; }), new Element("下一页", undefined, () => { page += 1; })];
const close = new Element("×", undefined, () => {
  if (opens === 1) assert.equal(downloads.length, 11, "ready files must download before refresh");
  opened = false;
  buttonDelay = 2;
});
const dialog = new Element(() => `申请下载 每页 ${size} 条 第${page}页 / 第${Math.ceil(rows.length / size)}页 共35条`,
  (selector) => selector === "select.page-size-select" ? [select]
    : selector === "table#downloadList" ? [table]
    : selector === "table tr" ? rows.slice((page - 1) * size, page * size)
    : selector === ".placeLoad-header .close-Load" ? [close]
    : selector.includes("span#first") ? navigation
    : selector === "#first" ? [navigation[0]] : selector === "#next" ? [navigation[2]] : []);
const header = new Element("", (selector) => selector === "th,td"
  ? ["请求时间", "文件名", "下载状态", "操作"].map((text) => new Element(text)) : []);
const table = new Element("", (selector) => selector === "tr" ? [header] : []);
table.parentElement = dialog;
const wrapper = new Element();
dialog.parentElement = wrapper;
const launch = new Element("下载暂存列表", undefined, () => { opened = true; opens += 1; size = 5; page = 1; });
launch.getClientRects = () => buttonDelay-- > 0 ? [] : [1];
let resourceEntries = [{ name: "/uisportal/accountCheckDetailQry/selectDeailBillList", startTime: 1, responseEnd: 2, responseStatus: 200 }];
const context = vm.createContext({
  Element, Event, Date, setTimeout,
  performance: { now: () => 0, getEntriesByType: () => resourceEntries },
  getComputedStyle: (element) => ({ display: "block", visibility: "visible", opacity: element === wrapper && !opened ? "0" : "1" }),
  location: { hostname: "service.chinaums.com", pathname: "/uisportal/accountCheckDetailQry/toDetail" },
  document: {
    // 背景/残留文字不得被当成仍打开的下载列表。
    body: new Element(() => `${dialog.innerText} ${rows[0].innerText}`),
    querySelectorAll: (selector) => selector === "button#download" ? [launch]
      : selector === ".loadSave-row" ? [dialog]
      : selector.includes('[role="dialog"]') ? [dialog] : []
  }
});
for (const file of ["account-detail.js", "download-runner.js"]) {
  vm.runInContext(fs.readFileSync(`${__dirname}/${file}`, "utf8"), context);
}

(async () => {
  const adapter = context.__chinaumsAccountDetailAdapter;
  const invoke = async (operation, args) => {
    const result = await adapter(operation, args);
    if (operation !== "parseDownloadTasks" || result.status !== "loading") return result;
    await new Promise((resolve) => setTimeout(resolve, 510));
    return adapter(operation, args);
  };
  resourceEntries[0].startTime = -1;
  await invoke("openDownloadList");
  assert.equal((await adapter("parseDownloadTasks")).status, "loading", "old request cannot validate retained rows");
  resourceEntries[0].startTime = 1;
  assert.equal((await adapter("parseDownloadTasks")).status, "loading", "fresh response still waits for stable content");
  assert.equal((await invoke("parseDownloadTasks")).hasNext, true);
  await invoke("nextDownloadPage");
  resourceEntries[0].responseStatus = 503;
  assert.equal((await adapter("parseDownloadTasks")).status, "refresh_error");
  resourceEntries[0].responseStatus = 200;
  assert.equal((await invoke("parseDownloadTasks")).page, 2);
  await invoke("selectDownloadPage", { page: 1 });
  assert.equal(page, 1);
  opens = 0; opened = false;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 24);
  const result = await context.CHINAUMS_DOWNLOAD_RUNNER.run({
    invoke: async (operation, args) => {
      if (operation === "confirmDownload") {
        assert(downloads.includes(args.fileName));
        return { status: "download_completed", downloadId: downloads.length };
      }
      return invoke(operation, args);
    }, reportType: "account-detail", merchantNo, startedAt: start.toISOString(),
    submittedMonths: Array.from({ length: 12 }, (_, index) => ({ month: `2026-${index + 1}`, remoteFileName: rows[index].querySelectorAll("td")[1].innerText, submittedAt: start.toISOString() })),
    gate: { allowed: true, merchantNo }, checkpoint: async () => {}, sleep: async () => {}, transition: async () => {}
  });
  assert.equal(result.length, 12);
  assert.equal(downloads.length, 12);
  assert.deepEqual(pageSizes, [20, 20]);
  assert.equal(opened, false);
  assert.equal((await invoke("parseDownloadTasks")).status, "not_found");
  assert.equal(page, 1, "no need to scan historical pages once all current tasks are found");
  console.log("PASS: native page size 20, navigation, ready-first downloads, refresh, no duplicates and final close");
})().catch((error) => { console.error(error); process.exitCode = 1; });

