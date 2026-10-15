const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function check(response) {
  let applies = 0;
  const ranges = [], events = [];
  const context = vm.createContext({
    Date, URLSearchParams, AbortController, AbortSignal, setTimeout, clearTimeout,
    location: { protocol: "https:", hostname: "service.chinaums.com" },
    localStorage: { getItem: () => "TEST_TOKEN", setItem() {} },
    fetch: async (url, options) => {
      const payload = JSON.parse(options.body);
      let data;
      if (url.endsWith("/init")) {
        data = { success: true, code: "000000", data: "TEST_TOKEN" };
      } else if (url.endsWith("/queryList")) {
        data = { success: true, code: "000000", data: {
          size: 500, current: 0, total: 1, pages: 1,
          list: [{ id: "row-1", mchntId: "merchant-id", transDate: payload.beginTransDate }]
        } };
      } else if (url.endsWith("/qryExportDtls")) {
        data = { success: true, code: "000000", data: { list: [], pages: 1, total: 0 } };
      } else if (url.endsWith("/applyExport")) {
        applies++;
        if (response instanceof Error) throw response;
        data = response;
      } else {
        throw new Error(`Unexpected request: ${url}`);
      }
      return { ok: true, status: 200, json: async () => data };
    }
  });
  for (const file of ["trade-audit.js", "monthly-runner.js"]) {
    vm.runInContext(fs.readFileSync(`${__dirname}/../${file}`, "utf8"), context);
  }
  await assert.rejects(context.CHINAUMS_MONTHLY_RUNNER.run({
    reportType: "trade-audit",
    gate: { authentication: { status: "logged_in", confidence: "high" } },
    checkpoint: async () => {}, sleep: async () => {},
    transition: async event => events.push(event),
    onRangesChanged: async selected => ranges.push(selected),
    invoke: context.__chinaumsTradeAuditAdapter
  }), /UNKNOWN/);
  assert.equal(applies, 1, "unclassified server errors must not repeat applyExport");
  assert.equal(ranges.length, 1, "unknown submission must not switch to monthly ranges");
  assert.match(ranges[0][0].key, /全年$/);
  assert.equal(events.at(-1).status, "UNKNOWN");
}

(async () => {
  // Synthetic rejection wording is not evidence of a server refusal contract.
  await check({ success: false, code: "999999", message: "导出跨度超限，服务端拒绝", data: null });
  await check({ success: false, code: "999999", message: "系统异常", data: null });
  await check(new Error("network timeout"));
  console.log("PASS: real trade adapter and range runner stop on unclassified rejection or transport failure without export replay");
})().catch(error => { console.error(error); process.exitCode = 1; });
