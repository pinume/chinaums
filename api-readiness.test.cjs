const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  getClientRects() { return [1]; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  closest() { return null; }
}
const common = {
  Element,
  Date,
  AbortController,
  AbortSignal,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" })
};

const account = vm.createContext({
  ...common,
  location: { hostname: "service.chinaums.com", pathname: "/uisportal/accountCheckDetailQry/toDetail" },
  document: {
    body: new Element(),
    documentElement: new Element(),
    querySelectorAll: () => []
  },
  fetch: async () => { throw new Error("not called by inspect"); }
});
vm.runInContext(fs.readFileSync(__dirname + "/account-detail.js", "utf8"), account);

const trade = vm.createContext({
  ...common,
  location: { hostname: "service.chinaums.com", pathname: "/uisportalfront/", hash: "#/auditOfTrade2026" },
  localStorage: { getItem: (key) => key === "userPortalVerifyToken" ? "TEST_TOKEN" : null },
  document: {
    body: new Element(),
    documentElement: new Element(),
    querySelectorAll: () => []
  },
  fetch: async () => { throw new Error("not called by inspect"); },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  }
});
vm.runInContext(fs.readFileSync(__dirname + "/trade-audit.js", "utf8"), trade);

(async () => {
  const accountInspection = await account.__chinaumsAccountDetailAdapter("inspect");
  const tradeInspection = await trade.__chinaumsTradeAuditAdapter("inspect");
  assert.deepEqual(
    { account: accountInspection.status, trade: tradeInspection.status },
    { account: "ready", trade: "ready" },
    "API readiness must not depend on account form or trade Vue table internals"
  );

  console.log("PASS: both report adapters are API-ready without page-private form/Vue query controls");
})().catch((error) => { console.error(error); process.exitCode = 1; });
