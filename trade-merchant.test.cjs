const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");



let token = "TEST_TOKEN";
let queryMerchantId = "merchant-id";
let queryCalls = 0;
let applyCalls = 0;
let responseData = { success: true, code: "000000", message: "成功", data: null };
let lastApply = null;
const respond = async (payload, endpoint, options) => {
  if (endpoint.endsWith("/queryList")) {
    queryCalls += 1;
    return {
      success: true,
      code: "000000",
      message: "成功",
      data: {
        size: 10,
        current: payload.current,
        total: 1,
        pages: 1,
        list: [{ id: `row-${queryCalls}`, mchntId: queryMerchantId, transDate: "20260915" }]
      }
    };
  }
  if (endpoint.endsWith("/applyExport")) {
    applyCalls += 1;
    lastApply = { payload: JSON.parse(JSON.stringify(payload)), options };
    return responseData;
  }
  throw new Error(endpoint);
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
  AbortSignal,
  localStorage: { getItem: (key) => { assert.equal(key, "userPortalVerifyToken"); return token; }, setItem: (key, value) => { assert.equal(key, "userPortalVerifyToken"); token = value; } },
  location: { protocol: "https:", hostname: "service.chinaums.com", pathname: "/uisportalfront/", hash: "#/auditOfTrade2026" },
  setTimeout,
  clearTimeout
});
vm.runInContext(fs.readFileSync(`${__dirname}/trade-audit.js`, "utf8"), context);

async function ready(adapter) {
  return adapter("query", { start: "2026-09-01", end: "2026-09-30",
    operationDeadline: Date.now() + 10000, targetMerchantId: "merchant-id" });
}

(async () => {
  const adapter = context.__chinaumsTradeAuditAdapter;
  assert.equal((await ready(adapter)).status, "ready");
  const gate = {
    allowed: true,
    merchantId: "merchant-id",
    authentication: { status: "logged_in", confidence: "high" }
  };

  let result = await adapter("submitExport", {
    gate,
    targetMerchantId: "merchant-id",
    operationDeadline: Date.now() + 30000
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.source, "api");
  assert.equal(queryCalls, 2, "submit must recheck merchant through queryList before applyExport");
  assert.equal(applyCalls, 1);
  assert.deepEqual(lastApply.payload, {
    merOrderId: "",
    transRef: "",
    statusList: [],
    beginTransDate: "20260901",
    endTransDate: "20260930"
  });
  assert.equal(lastApply.options.headers.userPortalToken, "TEST_TOKEN");

  queryMerchantId = "other-merchant";
  const applyBeforeSwitch = applyCalls;
  result = await adapter("submitExport", {
    gate,
    targetMerchantId: "merchant-id",
    operationDeadline: Date.now() + 30000
  });
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /商户身份已变化/);
  assert.equal(applyCalls, applyBeforeSwitch, "merchant switch must stop before applyExport");
  queryMerchantId = "merchant-id";

  responseData = {
    success: false,
    code: "999999",
    message: "当前已经有超过12条申请在处理中，请稍后",
    data: null
  };
  result = await adapter("submitExport", {
    gate,
    targetMerchantId: "merchant-id",
    operationDeadline: Date.now() + 30000
  });
  assert.equal(result.status, "throttled");

  responseData = { success: false, code: "999999", message: "系统异常", data: null };
  result = await adapter("submitExport", {
    gate,
    targetMerchantId: "merchant-id",
    operationDeadline: Date.now() + 30000
  });
  assert.equal(result.status, "unknown");

  token = "";
  const applyBeforeToken = applyCalls;
  result = await adapter("submitExport", {
    gate,
    targetMerchantId: "merchant-id",
    operationDeadline: Date.now() + 30000
  });
  assert.equal(result.status, "blocked");
  assert.equal(applyCalls, applyBeforeToken);
  token = "TEST_TOKEN";

  assert.equal((await adapter("query", { start: "2026-02-30", end: "2026-03-01" })).status, "failed");
  const applyBeforeUnqueriedRange = applyCalls;
  result = await adapter("submitExport", {
    gate,
    targetMerchantId: "merchant-id",
    operationDeadline: Date.now() + 30000
  });
  assert.equal(result.status, "blocked", "invalid query must invalidate the previous query result");
  assert.equal(applyCalls, applyBeforeUnqueriedRange);

  console.log("PASS: trade applyExport rechecks queryList merchant identity and needs no date/query/export/list UI controls");
})().catch((error) => { console.error(error); process.exitCode = 1; });
