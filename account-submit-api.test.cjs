const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");


const merchantNo = "89813015722APT1";
const queryFields = [
  "settDateBegin", "settDateEnd", "pageSize", "dealDateBegin", "dealDateEnd", "transStatus",
  "dealType", "busiTypeIdList", "fdId", "zdCode", "amount1", "amount2", "fkhNo",
  "bankCardNo1", "bankCardNo2", "dealMode", "bingJieFlag", "refNum", "merOrderId",
  "bankOrder", "searchNo", "searchObj"
];
const exportOnlyFields = ["fileExt", "regularFee", "d1Fee"];
const fieldNames = [...queryFields, ...exportOnlyFields];

let exportResponse = { respDesc: "对账明细下载成功", respCode: "000000" };
let queryMerchant = merchantNo;
let queryCount = 1;
let queryCalls = 0;
let exportCalls = 0;
let lastExportRequest = null;

const context = vm.createContext({
  URLSearchParams,
  AbortController,
  Date,
  setTimeout,
  clearTimeout,
  location: { protocol: "https:", hostname: "service.chinaums.com", pathname: "/uisportal/accountCheckDetailQry/toDetail" },
  fetch: async (url, options) => {
    if (url === "/uisportal/accountCheckDetailQry/qryAccountCheck") {
      queryCalls += 1;
      const payload = new URLSearchParams(options.body);
      return { ok: true, status: 200, json: async () => ({
        respCode: "000000",
        respDesc: "通用对账明细查询成功",
        regularFee: "regular-fee",
        d1Fee: "d1-fee",
        pageObj: {
          content: Array.from({ length: queryCount }, (_, index) => ({
            rownum_: index + 1,
            mer_no: queryMerchant,
            sett_date: payload.get("settDateBegin"),
            bankorder: `order-${index + 1}`
          })),
          totalPages: 1,
          totalElements: queryCount,
          number: 0,
          size: 100
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
  assert.equal((await adapter("query", { start: "2026-10-04", end: "2026-10-04",
    operationDeadline: Date.now() + 10000, targetMerchantNo: merchantNo })).status, "ready");
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
  assert.equal(body.get("pageSize"), "100");
  assert.equal(body.get("transStatus"), "1");
  assert.equal(body.get("searchObj"), "1");
  assert.equal(body.get("fileExt"), "xlsx");
  assert.equal(body.get("regularFee"), "regular-fee");
  assert.equal(body.get("d1Fee"), "d1-fee");
  assert.deepEqual([...body.keys()], fieldNames);

  queryCount = 2;
  const exportsBeforeCountDrift = exportCalls;
  result = await submit(adapter);
  assert.equal(result.status, "blocked", "changed account result count must block before downDeailBill");
  assert.match(result.reason, /数据状态已变化/);
  assert.equal(exportCalls, exportsBeforeCountDrift);
  queryCount = 1;

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

  context.document = new Proxy({}, {get() { throw new Error("must not read webpage filters"); }});
  const exportsBeforePageChange = exportCalls;
  result = await submit(adapter);
  assert.equal(result.status, "unknown");
  assert.equal(exportCalls, exportsBeforePageChange + 1, "website filters must not affect fixed API parameters");

  console.log("PASS: account submit rechecks qryAccountCheck identity/filter state, then uses captured downDeailBill payload and exact throttle classification");
})().catch((error) => { console.error(error); process.exitCode = 1; });
