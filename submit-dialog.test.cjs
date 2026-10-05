const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = vm.createContext({
  location: { protocol: "https:", hostname: "service.chinaums.com", pathname: "/uisportal/home" },
  Date, AbortController, setTimeout, clearTimeout,

});
vm.runInContext(fs.readFileSync(`${__dirname}/trade-audit.js`, "utf8"), context);
(async () => {
  for (const operation of ["inspect", "submitDialogState", "classifySubmit", "closeSubmitDialog", "closeDownloadList", "openDownloadList", "parseDownloadTasks", "downloadTask"]) {
    assert.equal((await context.__chinaumsTradeAuditAdapter(operation)).status, "unknown_operation");
  }
  context.location.hostname = "other.example";
  assert.equal((await context.__chinaumsTradeAuditAdapter("query")).status, "wrong_page");
  context.location.hostname = "service.chinaums.com";
  context.location.protocol = "http:";
  assert.equal((await context.__chinaumsTradeAuditAdapter("query")).status, "wrong_page");
  console.log("PASS: trade-audit.js needs no business page DOM and has no dialog/list operations");
})().catch(error => { console.error(error); process.exitCode = 1; });
