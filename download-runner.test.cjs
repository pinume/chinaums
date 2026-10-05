const assert = require("node:assert/strict");
require("./download-runner.js");

const originalDateNow = Date.now;
const merchantNo = "89813014812B06R";
const fileName = `${merchantNo}_MX_20260930120001.xlsx`;

async function checkAccount(mode = "success") {
  let now = new Date(2026, 8, 30, 12, 0, 2).getTime();
  const generationStartedAt = now;
  Date.now = () => now;
  let snapshotCalls = 0;
  let opens = 0;
  let downloads = 0;
  let opened = false;
  let closing = false;
  let closeReads = 0;
  let openingReads = mode === "delayed-open" ? 3 : 0;
  let waitedMs = 0;
  let waitingForGeneration = false;
  const events = [];
  const calls = [];

  const result = globalThis.CHINAUMS_DOWNLOAD_RUNNER.run({
    reportType: "account-detail",
    merchantNo,
    startedAt: new Date(2026, 8, 30, 12, 0, 0).toISOString(),
    submittedMonths: [{
      month: "2026-09",
      remoteFileName: fileName,
      remoteTaskId: mode === "missing-id" ? null : "task-1",
      submittedAt: "2026-09-30T04:00:00.000Z"
    }],
    gate: { allowed: true, merchantNo },
    checkpoint: async () => {
      if (mode === "stop-wait" && waitingForGeneration && waitedMs >= 1000) {
        throw new Error("STOPPED_BY_USER");
      }
    },
    sleep: async (milliseconds) => {
      now += milliseconds;
      if (waitingForGeneration) waitedMs += milliseconds;
    },
    transition: async (event) => {
      events.push(event);
      if (event.status === "WAITING_GENERATION") waitingForGeneration = true;
    },
    invoke: async (operation, args = {}) => {
      calls.push(operation);
      switch (operation) {
        case "snapshotExportTasks": {
          snapshotCalls += 1;
          assert.deepEqual(args.taskIds, ["task-1"]);
          if (mode === "api-error") return { status: "error", reason: "temporary failure" };
          if (mode === "mismatch") {
            return { status: "found", rows: [{ id: "task-1", fileName: `${merchantNo}_MX_20260930120002.xlsx`, taskStatus: "30", statusCode: "ready" }] };
          }
          const pending = mode === "stop-wait" ||
            (mode === "api-wait" && snapshotCalls < 3) ||
            (mode === "long-generation" && now - generationStartedAt < 180000);
          return {
            status: "found",
            rows: [{ id: "task-1", fileName, taskStatus: pending ? "10" : "30", statusCode: pending ? "pending" : "ready" }]
          };
        }
        case "openDownloadList":
          opens += 1;
          opened = true;
          return { status: "clicked" };
        case "setDownloadPageSize":
          return { status: "unchanged" };
        case "parseDownloadTasks":
          if (mode === "never-open") return { status: "not_open" };
          if (openingReads > 0) {
            openingReads -= 1;
            return { status: "not_open" };
          }
          if (closing) {
            if (mode !== "stuck" && ++closeReads >= 2) {
              opened = false;
              closing = false;
              return { status: "not_found" };
            }
          }
          if (!opened) return { status: "not_found" };
          return {
            status: "found",
            page: 1,
            total: 1,
            hasNext: false,
            rows: [{
              fileName,
              createdAt: "2026-09-30 12:00:01",
              statusCode: mode === "ui-not-ready" ? "pending" : "ready",
              downloadEnabled: mode !== "ui-not-ready"
            }]
          };
        case "downloadTask":
          downloads += 1;
          return { status: "download_requested" };
        case "confirmDownload":
          return { status: "download_completed", downloadId: downloads };
        case "closeDownloadList":
          if (mode === "close") return { status: "blocked" };
          closing = true;
          closeReads = 0;
          return { status: "closed" };
        default:
          throw new Error(`Unexpected operation: ${operation}`);
      }
    }
  });

  if (mode === "missing-id") {
    await assert.rejects(result, /缺少本轮已确认的暂存任务 ID/);
    assert.equal(calls.length, 0);
    return;
  }
  if (mode === "api-error") {
    await assert.rejects(result, /对账明细暂存接口连续 3 次读取失败/);
    assert.equal(snapshotCalls, 3);
    assert.equal(opens, 0);
    return;
  }
  if (mode === "mismatch") {
    await assert.rejects(result, /文件名与本轮记录不一致/);
    assert.equal(opens, 0);
    return;
  }
  if (mode === "stop-wait") {
    await assert.rejects(result, /STOPPED_BY_USER/);
    assert.equal(waitedMs, 1000);
    assert.equal(opens, 0);
    return;
  }
  if (mode === "ui-not-ready") {
    await assert.rejects(result, /接口已确认本轮对账明细任务全部生成成功/);
    assert.equal(opens, 1);
    assert.equal(downloads, 0);
    assert.equal(calls.filter((item) => item === "openDownloadList").length, 1);
    return;
  }
  if (mode === "close") {
    await assert.rejects(result, /无法关闭暂存列表/);
    assert.equal(downloads, 1);
    return;
  }
  if (mode === "stuck") {
    await assert.rejects(result, /关闭结果无法确认/);
    assert.equal(downloads, 1);
    return;
  }
  if (mode === "never-open") {
    await assert.rejects(result, /暂存列表打开后未能读取/);
    assert.equal(opens, 1);
    assert.equal(downloads, 0);
    return;
  }

  const rows = await result;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fileName, fileName);
  assert.equal(downloads, 1);
  assert.equal(opens, 1, "account download list must open only once after API readiness");
  if (mode === "api-wait") {
    assert.equal(snapshotCalls, 3);
    assert.deepEqual(events.filter((event) => event.status === "WAITING_GENERATION")
      .map((event) => [event.found, event.ready, event.remaining]), [[1, 0, 1], [1, 0, 1]]);
  }
  if (mode === "long-generation") {
    assert(now - generationStartedAt >= 180000);
    assert(events.some((event) => event.status === "WAITING_GENERATION" && event.waitedMs >= 120000));
  }
}

async function checkTradeCloseRetry() {
  let now = new Date(2026, 8, 30, 12, 0, 2).getTime();
  Date.now = () => now;
  const tradeFile = `MER_${merchantNo}_20260930120001_yjhx.xlsx`;
  let closeAttempts = 0;
  let opened = false;
  const calls = [];
  await globalThis.CHINAUMS_DOWNLOAD_RUNNER.run({
    reportType: "trade-audit",
    merchantNo,
    startedAt: new Date(2026, 8, 30, 12, 0, 0).toISOString(),
    submittedMonths: [{ month: "2026-09", remoteFileName: tradeFile, remoteTaskId: "task-1", submittedAt: "2026-09-30T04:00:00.000Z" }],
    gate: { allowed: true, merchantNo },
    checkpoint: async () => {},
    sleep: async (milliseconds) => { now += milliseconds; },
    transition: async () => {},
    invoke: async (operation) => {
      calls.push(operation);
      if (operation === "snapshotExportTasks") {
        return { status: "found", rows: [{ id: "task-1", fileName: tradeFile, statusCode: "ready", exportStatus: "02", exportStatusDesc: "成功" }] };
      }
      if (operation === "openDownloadList") { opened = true; return { status: "clicked" }; }
      if (operation === "parseDownloadTasks") {
        if (!opened) return { status: "not_open" };
        return { status: "found", page: 1, total: 1, hasNext: false,
          rows: [{ fileName: tradeFile, createdAt: "2026-09-30 12:00:01", statusCode: "ready", downloadEnabled: true }] };
      }
      if (operation === "downloadTask") return { status: "download_requested" };
      if (operation === "confirmDownload") return { status: "download_completed", downloadId: 1 };
      if (operation === "closeDownloadList") {
        closeAttempts += 1;
        if (closeAttempts >= 4) { opened = false; return { status: "already_closed" }; }
        return { status: "closed" };
      }
      throw new Error(operation);
    }
  });
  const closeIndex = calls.indexOf("closeDownloadList");
  assert.deepEqual(calls.slice(closeIndex), ["closeDownloadList", "parseDownloadTasks",
    "closeDownloadList", "parseDownloadTasks", "closeDownloadList", "parseDownloadTasks",
    "closeDownloadList"]);
}

(async () => {
  for (const mode of ["success", "api-wait", "api-error", "mismatch", "ui-not-ready", "close",
    "stuck", "delayed-open", "never-open", "stop-wait", "long-generation", "missing-id"]) {
    await checkAccount(mode);
  }
  let calls = 0;
  await assert.rejects(globalThis.CHINAUMS_DOWNLOAD_RUNNER.run({
    submittedMonths: [{ remoteFileName: fileName }, { remoteFileName: fileName }],
    startedAt: new Date().toISOString(),
    invoke: async () => { calls += 1; }
  }), /同一远端文件名/);
  assert.equal(calls, 0);
  await checkTradeCloseRetry();
  console.log("PASS: account generation uses exact task API polling, opens the list once, and keeps final UI/download guards");
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { Date.now = originalDateNow; });
