const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor(text = "") {
    this.innerText = text;
    this.textContent = text;
    this.disabled = false;
    this.classList = { contains: () => false };
  }
  getClientRects() { return [1]; }
  closest() { return null; }
  querySelectorAll() { return []; }
}

const merchantId = "internal-id";
const dateInput = new Element();
dateInput.value = "2026/10/01 ~ 2026/10/05";
const queryButton = new Element("查询");
const exportButton = new Element("批量导出");
exportButton.click = () => { throw new Error("direct trade submit must not click 批量导出"); };
const listButton = new Element("下载暂存列表");

let responseData = { success: true, code: "000000", message: "成功", data: null };
let apiCalls = 0;
let lastCall = null;
const component = {
  $options: { name: "table" },
  tableData: [{ mchntId: merchantId }],
  $axiosApi: {
    axiosPromisePara: async (payload, endpoint, options) => {
      apiCalls += 1;
      lastCall = { payload, endpoint, options };
      return responseData;
    }
  }
};
const table = new Element();
table.__vue__ = { $parent: component };

const buttons = [queryButton, exportButton, listButton];
const context = vm.createContext({
  Element,
  Date,
  AbortSignal,
  localStorage: {
    getItem: (key) => {
      assert.equal(key, "userPortalVerifyToken");
      return "TEST_TOKEN";
    }
  },
  location: {
    hostname: "service.chinaums.com",
    pathname: "/uisportalfront/",
    hash: "#/auditOfTrade2026"
  },
  getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
  document: {
    body: new Element("根据查询条件共查询到 1 条记录"),
    documentElement: new Element(),
    querySelectorAll(selector) {
      if (selector === "button") return buttons;
      if (selector === "input.deal-date") return [dateInput];
      if (selector === ".el-table") return [table];
      if (selector.includes('[role="dialog"]')) return [];
      return [];
    }
  }
});

let source = fs.readFileSync(`${__dirname}/trade-audit.js`, "utf8");
source = source.replace(
  "globalThis.__chinaumsTradeAuditAdapter = async",
  "globalThis.__setTradeQueryTracker = (value) => { queryTracker = value; };\n  globalThis.__chinaumsTradeAuditAdapter = async"
);
vm.runInContext(source, context);

const setReady = () => context.__setTradeQueryTracker({
  dateValue: "2026/10/01 ~ 2026/10/05",
  resultState: "ready",
  merchantId
});
const submit = () => context.__chinaumsTradeAuditAdapter("submitExport", {
  gate: {
    allowed: true,
    merchantId,
    authentication: { status: "logged_in", confidence: "high" }
  },
  targetMerchantId: merchantId,
  operationDeadline: Date.now() + 12000
});

(async () => {
  setReady();
  let result = await submit();
  assert.equal(result.status, "accepted");
  assert.equal(result.source, "api");
  assert.equal(apiCalls, 1);
  assert.equal(lastCall.endpoint, "uis-tradein-server/portal/yjhx/v3/applyExport");
  assert.deepEqual(Object.fromEntries(Object.entries(lastCall.payload)), {
    merOrderId: "",
    transRef: "",
    statusList: [],
    beginTransDate: "20261001",
    endTransDate: "20261005"
  });
  assert.equal(lastCall.options.headers.userPortalToken, "TEST_TOKEN");
  assert(lastCall.options.signal instanceof AbortSignal);

  responseData = {
    success: false,
    code: "999999",
    message: "当前已经有超过12条申请在处理中，请稍后",
    data: null
  };
  setReady();
  result = await submit();
  assert.equal(result.status, "throttled");
  assert.equal(result.source, "api");

  responseData = { success: false, code: "999999", message: "系统异常", data: null };
  setReady();
  result = await submit();
  assert.equal(result.status, "unknown", "uncaptured 999999 meanings must not be guessed as throttling");

  dateInput.value = "2026/10/02 ~ 2026/10/05";
  setReady();
  const callsBeforeDrift = apiCalls;
  result = await submit();
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /交易日期已变化/);
  assert.equal(apiCalls, callsBeforeDrift, "date drift must stop before applyExport side effect");

  console.log("PASS: trade applyExport uses captured payload, exact success/throttle classification, and blocks date drift");
})().catch((error) => { console.error(error); process.exitCode = 1; });
