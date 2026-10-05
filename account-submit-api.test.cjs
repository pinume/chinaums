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
  closest() { return null; }
  getAttribute() { return null; }
}
class HTMLInputElement extends Element {}

const merchantNo = "89813015722APT1";
const queryFields = [
  "settDateBegin", "settDateEnd", "pageSize", "dealDateBegin", "dealDateEnd", "transStatus",
  "dealType", "busiTypeIdList", "fdId", "zdCode", "amount1", "amount2", "fkhNo",
  "bankCardNo1", "bankCardNo2", "dealMode", "bingJieFlag", "refNum", "merOrderId",
  "bankOrder", "searchNo", "searchObj"
];
const exportOnlyFields = ["fileExt", "regularFee", "d"];
const fieldNames = [...queryFields, ...exportOnlyFields];
const formValues = Object.fromEntries(fieldNames.map((name) => [name, [""]]));
Object.assign(formValues, {
  settDateBegin: ["stale"],
  settDateEnd: ["stale"],
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

class FormData {
  constructor(target) { assert.equal(target, form); }
  *[Symbol.iterator]() {
    for (const name of fieldNames) {
      for (const value of formValues[name]) yield [name, value];
    }
  }
}

let exportResponse = { respDesc: "对账明细下载成功", respCode: "000000" };
let queryMerchant = merchantNo;
let queryCalls = 0;
let exportCalls = 0;
let lastExportRequest = null;

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
    body: new Element(),
    documentElement: new Element(),
    querySelectorAll(selector) {
      if (selector === "form") return [form];
      return [];
    }
  },
  fetch: async (url, options) => {
    if (url === "/uisportal/accountCheckDetailQry/qryAccountCheck") {
      queryCalls += 1;
      const payload = new URLSearchParams(options.body);
      return { ok: true, status: 200, json: async () => ({
        respCode: "000000",
        respDesc: "通用对账明细查询成功",
        pageObj: {
          content: [{ rownum_: 1, mer_no: queryMerchant, sett_date: payload.get("settDateBegin") }],
          totalPages: 1,
          totalElements: 1,
          number: 0,
          size: 5
        }
      }) };
    }
    if (url === "/uisportal/accountCheckDetailQry/downDeailBill") {
      exportCalls += 1;
      lastExportRequest = { url, options };
      return { ok: true, status: 200, json: async () => exportResponse };
    }
    throw new Error(url);
  }
});
vm.runInContext(fs.readFileSync(`${__dirname}/account-detail.js`, "utf8"), context);

async function ready(adapter) {
  assert.equal((await adapter("setDateRange", { start: "2026-10-04", end: "2026-10-04" })).status, "set");
  assert.equal((await adapter("query", { operationDeadline: Date.now() + 10000 })).status, "clicked");
  assert.equal((await adapter("queryState", { targetMerchantNo: merchantNo })).status, "ready");
}
const submit = (adapter) => adapter("submitExport", {
  gate: { allowed: true, merchantNo },
  targetMerchantNo: merchantNo,
  operationDeadline: Date.now() + 30000
});

(async () => {
  const adapter = context.__chinaumsAccountDetailAdapter;

  await ready(adapter);
  let result = await submit(adapter);
  assert.equal(result.status, "accepted");
  assert.equal(result.source, "api");
  assert.equal(queryCalls, 2, "submit must recheck qryAccountCheck before downDeailBill");
  assert.equal(exportCalls, 1);
  assert.equal(lastExportRequest.options.method, "POST");
  assert.equal(lastExportRequest.options.credentials, "same-origin");
  assert.equal(lastExportRequest.options.headers["X-Requested-With"], "XMLHttpRequest");
  const body = new URLSearchParams(lastExportRequest.options.body);
  assert.equal(body.get("settDateBegin"), "20261004");
  assert.equal(body.get("settDateEnd"), "20261004");
  assert.equal(body.get("pageSize"), "5");
  assert.equal(body.get("transStatus"), "1");
  assert.equal(body.get("searchObj"), "1");
  assert.equal(body.get("fileExt"), "xlsx");
  assert.deepEqual([...body.keys()], fieldNames);

  queryMerchant = "OTHER";
  const exportsBeforeSwitch = exportCalls;
  result = await submit(adapter);
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /商户、查询条件或数据状态已变化/);
  assert.equal(exportCalls, exportsBeforeSwitch, "merchant switch must stop before downDeailBill");
  queryMerchant = merchantNo;

  exportResponse = {
    respDesc: "您已有超过3条未处理或处理中的导出文件，请稍后再试",
    respCode: "999999"
  };
  result = await submit(adapter);
  assert.equal(result.status, "throttled");
  assert.equal(result.source, "api");

  exportResponse = { respDesc: "系统异常", respCode: "999999" };
  result = await submit(adapter);
  assert.equal(result.status, "unknown");

  formValues.transStatus = ["9"];
  const exportsBeforeDrift = exportCalls;
  result = await submit(adapter);
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /查询条件.*变化/);
  assert.equal(exportCalls, exportsBeforeDrift, "filter drift must stop before submit side effect");

  console.log("PASS: account submit rechecks qryAccountCheck identity/filter state, then uses captured downDeailBill payload and exact throttle classification");
})().catch((error) => { console.error(error); process.exitCode = 1; });
