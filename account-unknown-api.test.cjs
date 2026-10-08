const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const merchantNo = "89813015722APT1";
const attemptedAt = new Date(2026, 9, 5, 13, 36, 30).toISOString();
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
    Date: Clock
  });
  const baselineRows = mode === "duplicate-baseline"
    ? [{ id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]
    : [{ id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }];
  let submits = 0;
  let needsBaseline = false;
  const events = [];
  const invoke = async (operation, args) => {
    if (operation === "query") { needsBaseline = true; return { status: "ready", count: 1, merchantNo }; }
    if (operation === "submitExport") { submits++; return { status: "unknown" }; }
    if (needsBaseline) { needsBaseline = false; return { status: "found", rows: baselineRows }; }
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

  vm.runInContext(fs.readFileSync(`${__dirname}/monthly-runner.js`, "utf8"), context);
  const run = context.CHINAUMS_MONTHLY_RUNNER.run({
    months: [1, ...(mode === "already-bound" ? [2] : [])].map(month => ({
      key: `2026-0${month}`, start: `2026-0${month}-01`, end: `2026-0${month}-28`
    })),
    reportType: "account-detail", gate: {}, invoke,
    checkpoint: async () => {}, sleep: async milliseconds => { now += milliseconds; },
    now: () => now, transition: async event => events.push({ ...event })
  });
  let result;
  if (mode === "accepted") result = (await run)[0];
  else {
    await assert.rejects(run, /UNKNOWN/);
    result = events.at(-1);
  }
  assert.equal(submits, mode === "already-bound" ? 2 : 1, "unknown submissions must never be repeated");

  if (mode === "accepted") {
    assert.equal(result.status, "SUBMITTED");
    assert.equal(result.remoteTaskId, acceptedId);
    assert.equal(result.remoteFileName, fileName);
    assert.equal(result.remoteCreatedAt, "2026/10/05 13:36:31");
    assert.deepEqual(calls, ["snapshotExportTasks"]);
  } else {
    assert.equal(result.status, "UNKNOWN", mode);
    if (mode === "already-bound") assert.match(result.reason, /身份校验未通过/);
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
    "no-new", "read-error", "duplicate-baseline", "already-bound"]) {
    await check(mode);
  }
  console.log("PASS: account UNKNOWN reconciliation uses snapshot ID diff only and never opens the download list");
})().catch((error) => { console.error(error); process.exitCode = 1; });
