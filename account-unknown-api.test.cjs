const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const merchantNo = "89813015722APT1";
const attemptedAt = "2026-10-05T13:36:30.000Z";
const acceptedId = "0c057e50442143a68dbf9339784f2127";
const fileName = `${merchantNo}_MX_20261005133631.xlsx`;

async function check(mode) {
  let now = new Date(attemptedAt).getTime();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }

  const calls = [];
  const context = vm.createContext({
    Date: Clock,
    reportType: "account-detail",
    tabId: 1,
    normalize: (value) => String(value || "").replace(/\s/g, "").toUpperCase(),
    state: { months: {} },
    activeNow: () => now,
    checkpoint: async () => {},
    sleep: async (milliseconds) => { now += milliseconds; }
  });
  context.invoke = async (_, operation, args) => {
    calls.push(operation);
    assert.equal(operation, "snapshotExportTasks", "account UNKNOWN reconciliation must not use download-list UI");
    assert(args.operationDeadline > now);
    if (mode === "read-error") throw new Error("temporary read failure");
    const rows = [{
      id: acceptedId,
      fileName,
      createdAt: "2026/10/05 13:36:31"
    }];
    if (mode === "multiple") rows.push({
      id: "11111111111111111111111111111111",
      fileName: `${merchantNo}_MX_20261005133632.xlsx`,
      createdAt: "2026/10/05 13:36:32"
    });
    if (mode === "merchant-mismatch") rows[0].fileName = "OTHER_MX_20261005133631.xlsx";
    if (mode === "bad-id") rows[0].id = "bad-id";
    if (mode === "old-task") rows[0].createdAt = "2026/10/05 13:30:00";
    if (mode === "no-new") return { status: "found", rows: [{ id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      fileName: `${merchantNo}_MX_20261005130000.xlsx`, createdAt: "2026/10/05 13:00:00" }] };
    return { status: "found", rows };
  };

  const source = fs.readFileSync(`${__dirname}/export-runner.js`, "utf8");
  vm.runInContext(source.slice(
    source.indexOf("const parsePortalTimestamp ="),
    source.indexOf("const closeExistingSubmitNotice =")
  ) + "\nglobalThis.reconcile = reconcileUnknown;", context);

  const baselineRows = mode === "duplicate-baseline"
    ? [{ id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]
    : [{ id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }];
  const result = await context.reconcile({
    attemptedAt,
    targetMerchantNo: merchantNo,
    gate: { allowed: true, merchantNo },
    baselineRows
  });

  if (mode === "accepted") {
    assert.equal(result.status, "accepted");
    assert.equal(result.taskId, acceptedId);
    assert.equal(result.fileName, fileName);
    assert.equal(result.createdAt, "2026/10/05 13:36:31");
    assert.deepEqual(calls, ["snapshotExportTasks"]);
  } else {
    assert.equal(result.status, "unknown", mode);
    assert(!calls.some((operation) => [
      "classifySubmit", "openDownloadList", "parseDownloadTasks", "closeDownloadList"
    ].includes(operation)));
    if (["read-error", "no-new"].includes(mode)) {
      assert(now - new Date(attemptedAt).getTime() >= 15000);
    }
    if (mode === "duplicate-baseline") assert.equal(calls.length, 0);
  }
}

(async () => {
  for (const mode of ["accepted", "multiple", "merchant-mismatch", "bad-id", "old-task",
    "no-new", "read-error", "duplicate-baseline"]) {
    await check(mode);
  }
  console.log("PASS: account UNKNOWN reconciliation uses snapshot ID diff only and never opens the download list");
})().catch((error) => { console.error(error); process.exitCode = 1; });
