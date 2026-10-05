const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor(text = "") {
    this.innerText = text;
    this.textContent = text;
    this.parentElement = null;
    this.disabled = false;
    this.classList = { contains: () => false };
  }
  getClientRects() { return [1]; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  closest(selector) { return selector === "form" ? this.form || null : null; }
  getAttribute() { return null; }
}
class HTMLInputElement extends Element {}

const merchantNo = "89813015722APT1";
const fieldNames = [
  "settDateBegin", "settDateEnd", "pageSize", "dealDateBegin", "dealDateEnd", "transStatus",
  "dealType", "busiTypeIdList", "fdId", "zdCode", "amount1", "amount2", "fkhNo",
  "bankCardNo1", "bankCardNo2", "dealMode", "bingJieFlag", "refNum", "merOrderId",
  "bankOrder", "searchNo", "searchObj", "fileExt", "regularFee", "d"
];
const formValues = Object.fromEntries(fieldNames.map((name) => [name, [""]]));
Object.assign(formValues, {
  settDateBegin: ["20261004"],
  settDateEnd: ["20261004"],
  pageSize: ["5"],
  transStatus: ["1"],
  searchObj: ["1"],
  fileExt: ["csv"]
});

const form = new Element();
form.querySelector = (selector) => {
  const match = selector.match(/^\[name="([^"]+)"\]$/);
  return match && Object.hasOwn(formValues, match[1]) ? new Element() : null;
};
const exportButton = new Element("申请下载xlsx");
exportButton.form = form;
exportButton.click = () => { throw new Error("submit must not click the page export control"); };

class FormData {
  constructor(target) {
    assert.equal(target, form);
  }
  getAll(name) {
    return formValues[name] ? [...formValues[name]] : [];
  }
}

let responseData = { respDesc: "对账明细下载成功", respCode: "000000" };
let fetchCalls = 0;
let lastRequest = null;
const context = vm.createContext({
  Element,
  HTMLInputElement,
  FormData,
  URLSearchParams,
  AbortController,
  Date,
  setTimeout,
  clearTimeout,
  location: { hostname: "service.chinaums.com", pathname: "/uisportal/accountCheckDetailQry/toDetail" },
  getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
  document: {
    body: new Element("根据输入条件共查询到 1 条"),
    querySelectorAll(selector) {
      if (selector === "#crtt_download_xlsx") return [exportButton];
      if (selector === "form") return [form];
      return [];
    }
  },
  fetch: async (url, options) => {
    fetchCalls += 1;
    lastRequest = { url, options };
    return { ok: true, status: 200, json: async () => responseData };
  }
});

let source = fs.readFileSync(`${__dirname}/account-detail.js`, "utf8");
source = source.replace(
  "globalThis.__chinaumsAccountDetailAdapter = async",
  "globalThis.__setAccountQueryTracker = (value) => { queryTracker = value; };\n  globalThis.__chinaumsAccountDetailAdapter = async"
);
vm.runInContext(source, context);

const setReady = () => context.__setAccountQueryTracker({
  merchantNo,
  resultState: "ready",
  dateValue: "2026/10/04 ~ 2026/10/04"
});
const submit = () => context.__chinaumsAccountDetailAdapter("submitExport", {
  gate: { allowed: true, merchantNo },
  targetMerchantNo: merchantNo
});

(async () => {
  setReady();
  let result = await submit();
  assert.equal(result.status, "accepted");
  assert.equal(result.source, "api");
  assert.equal(fetchCalls, 1);
  assert.equal(lastRequest.url, "/uisportal/accountCheckDetailQry/downDeailBill");
  assert.equal(lastRequest.options.method, "POST");
  assert.equal(lastRequest.options.credentials, "same-origin");
  assert.equal(lastRequest.options.headers["X-Requested-With"], "XMLHttpRequest");
  const body = new URLSearchParams(lastRequest.options.body);
  assert.equal(body.get("settDateBegin"), "20261004");
  assert.equal(body.get("settDateEnd"), "20261004");
  assert.equal(body.get("pageSize"), "5");
  assert.equal(body.get("transStatus"), "1");
  assert.equal(body.get("searchObj"), "1");
  assert.equal(body.get("fileExt"), "xlsx", "XLSX export must override any page field value");
  assert.deepEqual([...body.keys()], fieldNames, "request must use the captured page export fields only");

  responseData = {
    respDesc: "您已有超过3条未处理或处理中的导出文件，请稍后再试",
    respCode: "999999"
  };
  setReady();
  result = await submit();
  assert.equal(result.status, "throttled");
  assert.equal(result.source, "api");

  responseData = { respDesc: "系统异常", respCode: "999999" };
  setReady();
  result = await submit();
  assert.equal(result.status, "unknown", "uncaptured 999999 meanings must not be guessed as throttling or failure");

  formValues.settDateBegin = ["20261003"];
  setReady();
  const callsBeforeMismatch = fetchCalls;
  result = await submit();
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /清算日期.*不一致/);
  assert.equal(fetchCalls, callsBeforeMismatch, "date mismatch must stop before the submit side effect");

  console.log("PASS: account XLSX submit uses captured API payload, classifies exact success/throttle responses, and blocks date drift");
})().catch((error) => { console.error(error); process.exitCode = 1; });
