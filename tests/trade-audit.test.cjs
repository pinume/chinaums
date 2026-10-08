const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");


let mode = "paged";
let token = "TEST_TOKEN";
const calls = [];
const merchantId = "merchant-id";
const makeRows = (count, current) => Array.from({ length: count }, (_, index) => ({
  id: `row-${current}-${index}`,
  mchntId: mode === "mixed" && index === 1 ? "other-merchant" : merchantId,
  transDate: mode === "bad-date" && current === 0 && index === 0 ? "20260831" : "20260915"
}));
const respond = async (payload, endpoint, options) => {
  calls.push({ payload: JSON.parse(JSON.stringify(payload)), endpoint, options });
  assert.equal(endpoint, "uis-tradein-server/portal/yjhx/v3/queryList");
  if (mode === "api-error") return { success: false, code: "999999", message: "系统异常", data: null };
  if (mode === "no-data") {
    return { success: true, code: "000000", message: "成功",
      data: { size: 500, current: 0, total: 0, pages: 0, list: [] } };
  }
  const current = payload.current;
  assert.equal(current, 0, "query must only request the first page");
  const list = makeRows(mode === "short-page" ? 499 : 500, 0);
  if (mode === "duplicate") list[1].id = list[0].id;
  return { success: true, code: "000000", message: "成功",
    data: { size: 500, current, total: 508, pages: 2, list } };
};

const context = vm.createContext({
  fetch: async (url, options) => {
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.headers["Content-Type"], "application/json");
    if (url === "/uisportal/api/userPortalVerify/init") return {ok:true,json:async()=>({
      success: Boolean(token), code:"000000", data:"TEST_TOKEN"
    })};
    assert.equal(options.headers.userPortalToken, "TEST_TOKEN");
    const data = await respond(JSON.parse(options.body), url.replace("/uisportal/api/", ""), options);
    return { ok: true, status: 200, json: async () => data };
  },
  Date,
  AbortController,
  localStorage: { getItem: (key) => { assert.equal(key, "userPortalVerifyToken"); return token; }, setItem: (key, value) => { assert.equal(key, "userPortalVerifyToken"); token = value; } },
  location: { protocol: "https:", hostname: "service.chinaums.com", pathname: "/uisportalfront/", hash: "#/auditOfTrade2026" },
  setTimeout,
  clearTimeout
});
vm.runInContext(fs.readFileSync(`${__dirname}/../trade-audit.js`, "utf8"), context);

(async () => {
  const adapter = context.__chinaumsTradeAuditAdapter;
  const query = (args = {}) => adapter("query", { start: "2026-09-01", end: "2026-09-30",
    operationDeadline: Date.now() + 10000, ...args });
  calls.length = 0;
  let state = await query({ targetMerchantId: merchantId });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), { status: "ready", count: 508, merchantId });
  assert.equal(calls.length, 1, "query must not read subsequent pages");
  assert.deepEqual(calls.map((call) => call.payload), [
    { merOrderId: "", transRef: "", status: [], beginTransDate: "20260901", endTransDate: "20260930", current: 0, size: 500 }
  ]);
  const gate = { allowed: true, merchantId, authentication: { status: "logged_in", confidence: "high" } };
  const assertBlocked = async () => assert.equal((await adapter("submitExport", { gate, targetMerchantId: merchantId })).status, "blocked");
  assert.equal((await query({ targetMerchantId: "other" })).status, "failed");
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
  for (const failedMode of ["mixed", "bad-date", "api-error", "short-page", "duplicate"]) {
    mode = "paged";
    assert.equal((await query()).status, "ready");
    mode = failedMode;
    state = await query();
    assert.equal(state.status, "failed");
    await assertBlocked();
  }
  mode = "paged";
  assert.equal((await query()).status, "ready");
  token = "";
  const beforeMissingToken = calls.length;
  assert.equal((await query()).status, "failed");
  assert.equal(calls.length, beforeMissingToken);
  await assertBlocked();
  console.log("PASS: trade query returns verified results in one call and blocks stale export after invalid input, identity mismatch or API failure");
})().catch((error) => { console.error(error); process.exitCode = 1; });
