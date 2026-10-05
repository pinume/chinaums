const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  getClientRects() { return [1]; }
  closest() { return null; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}
let mode = "paged";
let token = "TEST_TOKEN";
const calls = [];
const merchantId = "merchant-id";
const makeRows = (count, current) => Array.from({ length: count }, (_, index) => ({
  id: `row-${current}-${index}`,
  mchntId: mode === "mixed" && current === 1 && index === 0 ? "other-merchant" : merchantId,
  transDate: mode === "bad-date" && current === 0 && index === 0 ? "20260831" : "20260915"
}));
const fetch = async (url, options) => {
  assert.equal(url, "/uisportal/api/uis-tradein-server/portal/yjhx/v3/queryList");
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.headers["Content-Type"], "application/json;charset=UTF-8");
  assert.equal(options.headers.userPortalToken, "TEST_TOKEN");
  const payload = JSON.parse(options.body);
  calls.push({ payload, url, options });
  let data;
  if (mode === "api-error") data = { success: false, code: "999999", message: "系统异常", data: null };
  else if (mode === "no-data") {
    data = { success: true, code: "000000", message: "成功",
      data: { size: 10, current: 0, total: 0, pages: 0, list: [] } };
  } else {
    const current = payload.current;
    const list = current === 0 ? makeRows(10, 0) : makeRows(8, 1);
    data = { success: true, code: "000000", message: "成功",
      data: { size: 10, current, total: 18, pages: 2, list } };
  }
  return { ok: true, status: 200, json: async () => data };
};

const context = vm.createContext({
  Element,
  Date,
  AbortController,
  localStorage: { getItem: (key) => { assert.equal(key, "userPortalVerifyToken"); return token; } },
  location: { hostname: "service.chinaums.com", pathname: "/uisportalfront/", hash: "#/auditOfTrade2026" },
  getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
  document: { body: new Element(), documentElement: new Element(), querySelectorAll: () => [] },
  fetch,
  setTimeout,
  clearTimeout
});
vm.runInContext(fs.readFileSync(`${__dirname}/trade-audit.js`, "utf8"), context);

(async () => {
  const adapter = context.__chinaumsTradeAuditAdapter;
  const inspection = await adapter("inspect");
  assert.equal(inspection.status, "ready");
  assert.equal(inspection.hasQuery, true, "query readiness comes from the page API, not a query button");

  assert.equal((await adapter("setDateRange", { start: "2026-09-01", end: "2026-09-30" })).status, "set");
  assert.equal((await adapter("setDateRange", { start: "2026-02-30", end: "2026-03-01" })).status, "failed");
  assert.equal((await adapter("setDateRange", { start: "2026-10-05", end: "2026-10-01" })).status, "failed");
  await adapter("setDateRange", { start: "2026-09-01", end: "2026-09-30" });

  calls.length = 0;
  assert.equal((await adapter("query", { operationDeadline: Date.now() + 10000 })).status, "clicked");
  assert.equal(calls.length, 2, "all queryList pages must be read before merchant identity is accepted");
  assert.deepEqual(calls.map((call) => call.payload), [
    { merOrderId: "", transRef: "", status: [], beginTransDate: "20260901", endTransDate: "20260930", current: 0, size: 10 },
    { merOrderId: "", transRef: "", status: [], beginTransDate: "20260901", endTransDate: "20260930", current: 1, size: 10 }
  ]);
  let state = await adapter("queryState", { targetMerchantId: merchantId });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), { status: "ready", count: 18, merchantId });
  assert.equal((await adapter("queryState", { targetMerchantId: "other" })).status, "failed");

  mode = "no-data";
  await adapter("setDateRange", { start: "2026-10-01", end: "2026-10-05" });
  assert.equal((await adapter("query", { operationDeadline: Date.now() + 10000 })).status, "clicked");
  assert.deepEqual(JSON.parse(JSON.stringify(await adapter("queryState"))), { status: "no_data", count: 0 });

  mode = "mixed";
  await adapter("setDateRange", { start: "2026-09-01", end: "2026-09-30" });
  await adapter("query", { operationDeadline: Date.now() + 10000 });
  state = await adapter("queryState");
  assert.equal(state.status, "failed");
  assert.match(state.reason, /唯一商户身份/);

  mode = "bad-date";
  await adapter("setDateRange", { start: "2026-09-01", end: "2026-09-30" });
  await adapter("query", { operationDeadline: Date.now() + 10000 });
  assert.equal((await adapter("queryState")).status, "failed");

  mode = "api-error";
  await adapter("setDateRange", { start: "2026-09-01", end: "2026-09-30" });
  await adapter("query", { operationDeadline: Date.now() + 10000 });
  assert.equal((await adapter("queryState")).status, "failed");

  mode = "paged";
  token = "";
  await adapter("setDateRange", { start: "2026-09-01", end: "2026-09-30" });
  const beforeMissingToken = calls.length;
  const missingToken = await adapter("query", { operationDeadline: Date.now() + 10000 });
  assert.equal(missingToken.status, "clicked");
  assert.equal((await adapter("queryState")).status, "failed");
  assert.equal(calls.length, beforeMissingToken, "missing token must not issue queryList requests");

  console.log("PASS: trade queryList reads every page, validates dates/identity, handles no-data, and needs no date/query UI controls");
})().catch((error) => { console.error(error); process.exitCode = 1; });
