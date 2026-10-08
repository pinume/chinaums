const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");



let mode = "paged";
let calls = [];
const merchantNo = "89813015722APT1";
const makeRows = (pageNumber, count) => Array.from({ length: count }, (_, index) => ({
  rownum_: (pageNumber - 1) * 100 + index + 1,
  mer_no: mode === "mixed" && pageNumber === 2 && index === 0 ? "OTHER" : merchantNo,
  sett_date: mode === "bad-date" && pageNumber === 1 && index === 0 ? "20260831" : "20260930",
  bankorder: `order-${pageNumber}-${index}`
}));

const context = vm.createContext({
  URLSearchParams,
  AbortController,
  Date,
  setTimeout,
  clearTimeout,
  location: { protocol: "https:", hostname: "service.chinaums.com", pathname: "/uisportal/accountCheckDetailQry/toDetail" },
  fetch: async (url, options) => {
    assert.equal(url, "/uisportal/accountCheckDetailQry/qryAccountCheck");
    const payload = new URLSearchParams(options.body);
    calls.push(Object.fromEntries(payload));
    if (mode === "api-error") return { ok: false, status: 503, json: async () => ({}) };
    if (mode === "no-data") {
      return { ok: true, status: 200, json: async () => ({
        respCode: "000000",
        respDesc: "通用对账明细查询成功",
        pageObj: { content: [], totalPages: 0, totalElements: 0, number: 0, size: 100 }
      }) };
    }
    const pageNumber = Number(payload.get("pageNumber"));
    const count = pageNumber === 1 ? 100 : 2;
    const rows = mode === "duplicate-page" && pageNumber === 2
      ? makeRows(1, 2)
      : makeRows(pageNumber, count);
    return { ok: true, status: 200, json: async () => ({
      respCode: "000000",
      respDesc: "通用对账明细查询成功",
      summary: { count: 102 },
      pageObj: {
        content: rows,
        totalPages: 2,
        totalElements: 102,
        number: pageNumber - 1,
        size: 100
      }
    }) };
  }
});
vm.runInContext(fs.readFileSync(`${__dirname}/../account-detail.js`, "utf8"), context);

(async () => {
  const adapter = context.__chinaumsAccountDetailAdapter;
  const query = (args = {}) => adapter("query", { start: "2026-09-01", end: "2026-09-30",
    operationDeadline: Date.now() + 10000, ...args });
  calls = [];
  let state = await query({ targetMerchantNo: merchantNo });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), { status: "ready", count: 102, merchantNo });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].settDateBegin, "20260901");
  assert.equal(calls[0].settDateEnd, "20260930");
  assert.equal(calls[0].pageSize, "100");
  assert.equal(calls[0].transStatus, "1");
  assert.equal(calls[0].searchObj, "1");
  assert.equal(calls[0].busiTypeIdList, "");
  assert.equal(calls[0].pageNumber, "1");
  assert.equal(calls[1].pageNumber, "2");
  const gate = { allowed: true, merchantNo };
  const assertBlocked = async () => assert.equal((await adapter("submitExport", { gate, targetMerchantNo: merchantNo })).status, "blocked");
  assert.equal((await query({ targetMerchantNo: "OTHER" })).status, "failed");
  await assertBlocked();
  assert.equal((await query()).status, "ready");
  const beforeInvalid = calls.length;
  assert.equal((await query({ start: "2026-02-30", end: "2026-03-01" })).status, "failed");
  assert.equal(calls.length, beforeInvalid);
  await assertBlocked();
  assert.equal((await query({ start: "2026-10-05", end: "2026-10-01" })).status, "failed");
  assert.equal((await adapter("setDateRange")).status, "unknown_operation");
  assert.equal((await adapter("queryState")).status, "unknown_operation");

  mode = "no-data";
  assert.deepEqual(JSON.parse(JSON.stringify(await query({ start: "2026-10-01", end: "2026-10-05" }))), { status: "no_data", count: 0 });
  await assertBlocked();
  for (const failedMode of ["mixed", "duplicate-page", "bad-date", "api-error"]) {
    mode = "paged";
    assert.equal((await query()).status, "ready");
    mode = failedMode;
    state = await query();
    assert.equal(state.status, "failed");
    await assertBlocked();
  }
  console.log("PASS: account query returns a complete verified result in one call and invalidates prior results on every failure");
})().catch((error) => { console.error(error); process.exitCode = 1; });
