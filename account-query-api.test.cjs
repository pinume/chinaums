const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor() { this.parentElement = null; }
  getClientRects() { return [1]; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  closest() { return null; }
}
class HTMLInputElement extends Element {}

const fieldNames = [
  "settDateBegin", "settDateEnd", "pageSize", "dealDateBegin", "dealDateEnd", "transStatus",
  "dealType", "busiTypeIdList", "fdId", "zdCode", "amount1", "amount2", "fkhNo",
  "bankCardNo1", "bankCardNo2", "dealMode", "bingJieFlag", "refNum", "merOrderId",
  "bankOrder", "searchNo", "searchObj"
];
const formValues = Object.fromEntries(fieldNames.map((name) => [name, [""]]));
Object.assign(formValues, {
  settDateBegin: ["stale"],
  settDateEnd: ["stale"],
  pageSize: ["5"],
  transStatus: ["1"],
  searchObj: ["1"]
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

let mode = "paged";
let calls = [];
const merchantNo = "89813015722APT1";
const makeRows = (pageNumber, count) => Array.from({ length: count }, (_, index) => ({
  rownum_: (pageNumber - 1) * 5 + index + 1,
  mer_no: mode === "mixed" && pageNumber === 2 && index === 0 ? "OTHER" : merchantNo,
  sett_date: mode === "bad-date" && pageNumber === 1 && index === 0 ? "20260831" : "20260930",
  bankorder: `order-${pageNumber}-${index}`
}));

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
    assert.equal(url, "/uisportal/accountCheckDetailQry/qryAccountCheck");
    const payload = new URLSearchParams(options.body);
    calls.push(Object.fromEntries(payload));
    if (mode === "api-error") return { ok: false, status: 503, json: async () => ({}) };
    if (mode === "no-data") {
      return { ok: true, status: 200, json: async () => ({
        respCode: "000000",
        respDesc: "通用对账明细查询成功",
        pageObj: { content: [], totalPages: 0, totalElements: 0, number: 0, size: 5 }
      }) };
    }
    const pageNumber = Number(payload.get("pageNumber"));
    const count = pageNumber === 1 ? 5 : 2;
    return { ok: true, status: 200, json: async () => ({
      respCode: "000000",
      respDesc: "通用对账明细查询成功",
      summary: { count: 7 },
      pageObj: {
        content: makeRows(pageNumber, count),
        totalPages: 2,
        totalElements: 7,
        number: pageNumber - 1,
        size: 5
      }
    }) };
  }
});
vm.runInContext(fs.readFileSync(`${__dirname}/account-detail.js`, "utf8"), context);

(async () => {
  const adapter = context.__chinaumsAccountDetailAdapter;
  const inspection = await adapter("inspect");
  assert.equal(inspection.status, "ready");
  assert.equal(inspection.hasQuery, true, "API-ready form replaces date/query UI controls");

  assert.equal((await adapter("setDateRange", { start: "2026-09-01", end: "2026-09-30" })).status, "set");
  assert.equal((await adapter("setDateRange", { start: "2026-02-30", end: "2026-03-01" })).status, "failed");
  await adapter("setDateRange", { start: "2026-09-01", end: "2026-09-30" });

  calls = [];
  assert.equal((await adapter("query", { operationDeadline: Date.now() + 10000 })).status, "clicked");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].settDateBegin, "20260901");
  assert.equal(calls[0].settDateEnd, "20260930");
  assert.equal(calls[0].pageSize, "5");
  assert.equal(calls[0].pageNumber, "1");
  assert.equal(calls[1].pageNumber, "2");
  let state = await adapter("queryState", { targetMerchantNo: merchantNo });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), { status: "ready", count: 7, merchantNo });
  assert.equal((await adapter("queryState", { targetMerchantNo: "OTHER" })).status, "failed");

  mode = "no-data";
  await adapter("setDateRange", { start: "2026-10-01", end: "2026-10-05" });
  await adapter("query", { operationDeadline: Date.now() + 10000 });
  assert.deepEqual(JSON.parse(JSON.stringify(await adapter("queryState"))), { status: "no_data", count: 0 });

  mode = "mixed";
  await adapter("setDateRange", { start: "2026-09-01", end: "2026-09-30" });
  await adapter("query", { operationDeadline: Date.now() + 10000 });
  state = await adapter("queryState");
  assert.equal(state.status, "failed");
  assert.match(state.reason, /唯一商户号/);

  mode = "bad-date";
  await adapter("setDateRange", { start: "2026-09-01", end: "2026-09-30" });
  await adapter("query", { operationDeadline: Date.now() + 10000 });
  assert.equal((await adapter("queryState")).status, "failed");

  mode = "api-error";
  await adapter("setDateRange", { start: "2026-09-01", end: "2026-09-30" });
  await adapter("query", { operationDeadline: Date.now() + 10000 });
  assert.equal((await adapter("queryState")).status, "failed");

  console.log("PASS: account qryAccountCheck reads every page, validates merchant/date identity, and handles no-data without date/query UI controls");
})().catch((error) => { console.error(error); process.exitCode = 1; });
