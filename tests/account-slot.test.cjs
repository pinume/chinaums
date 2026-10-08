const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function check(mode) {
  let now = new Date(2026, 9, 3).getTime();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({ Date: Clock });
  vm.runInContext(fs.readFileSync(`${__dirname}/../monthly-runner.js`, "utf8"), context);

  const merchant = "89813015722APT1";
  const tasks = [];
  const events = [];
  let month;
  let submits = 0;
  let throttled = false;
  let slotPolls = 0;
  let waitStart;

  await context.CHINAUMS_MONTHLY_RUNNER.run({
    months: [1, 2].map((value) => ({
      key: `2026-0${value}`,
      start: `2026-0${value}-01`,
      end: `2026-0${value}-28`
    })),
    reportType: "account-detail",
    gate: {},
    checkpoint: async () => {},
    sleep: async (milliseconds) => { now += milliseconds; },
    transition: async (event) => {
      events.push(event);
      if (event.month) month = event.month;
      if (event.status === "WAITING_FOR_SLOT" && waitStart === undefined) waitStart = now;
    },
    invoke: async (operation, args = {}) => {
      if (operation === "submitDialogState") return { status: "clear" };
      if (operation === "query") return { status: "ready", count: 1, merchantNo: merchant };

      if (operation === "snapshotExportTasks") {
        if (Array.isArray(args.taskIds)) {
          slotPolls += 1;
          assert.deepEqual(Array.from(args.taskIds), ["2026-01"]);
          if (mode === "read-failure") throw new Error("temporary API failure");
          if (mode === "identity-mismatch") {
            return { status: "found", rows: [{
              id: "2026-01",
              fileName: `${merchant}_MX_20261003009999.xlsx`,
              statusCode: "ready"
            }] };
          }
          return { status: "found", rows: [{
            ...tasks[0],
            statusCode: slotPolls > 1 ? "ready" : "pending"
          }] };
        }
        return { status: "found", rows: tasks.map((task) => ({ ...task })) };
      }

      if (operation === "submitExport") {
        submits += 1;
        if (month === "2026-02" && !throttled) {
          throttled = true;
          return { status: "throttled", source: "api" };
        }
        tasks.push({
          id: month,
          fileName: `${merchant}_MX_2026100300000${tasks.length + 1}.xlsx`,
          statusCode: "pending"
        });
        return { status: "accepted", source: "api" };
      }

      if (operation === "classifySubmit") {
        throw new Error("direct account submit must not wait for UI classification");
      }
      if (operation === "closeSubmitDialog") return { status: "closed" };
      if (["openDownloadList", "parseDownloadTasks", "setDownloadPageSize", "closeDownloadList"].includes(operation)) {
        throw new Error(`slot wait must not use download-list UI: ${operation}`);
      }
      throw new Error(operation);
    }
  });

  assert.equal(submits, 3, "accepted first month must never be resubmitted");
  assert.equal(tasks.length, 2);
  assert(slotPolls >= 1);

  if (mode === "normal") {
    assert(now - waitStart < 30000, "pending -> ready API transition should release wait early");
    assert(events.some((event) => event.status === "WAITING_FOR_SLOT" &&
      event.slotSource === "api" && event.pending === 0));
  } else {
    assert(now - waitStart >= 30000, "API uncertainty must keep the original backoff");
  }
}

(async () => {
  await check("normal");
  await check("read-failure");
  await check("identity-mismatch");
  console.log("PASS: account slot wait polls exact task IDs through the API, releases early on generation progress, and falls back to backoff on uncertainty");
})().catch((error) => { console.error(error); process.exitCode = 1; });
