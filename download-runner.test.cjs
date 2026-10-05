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
  let directRequests = 0;
  let confirmations = 0;
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
      downloadedFileName: mode === "resume" ? fileName : null,
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
      if (operation === "snapshotExportTasks") {
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
      if (operation === "downloadTaskDirect") {
        directRequests += 1;
        assert.equal(args.taskId, "task-1");
        assert.equal(args.fileName, fileName);
        assert.equal(args.targetMerchantNo, merchantNo);
        assert.equal(args.gate.allowed, true);
        if (mode === "direct-blocked") return { status: "blocked", reason: "guard" };
        return { status: "download_requested", downloadId: 7 };
      }
      if (operation === "confirmDownload") {
        confirmations += 1;
        assert.equal(args.downloadId, 7, "confirmation must receive the ID from the download request");
        assert.equal(args.fileName, fileName);
        if (mode === "confirm-fail") return { status: "download_unknown" };
        return { status: "download_completed", downloadId: 7 };
      }
      throw new Error(`Unexpected operation: ${operation}`);
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
    assert.equal(directRequests, 0);
    return;
  }
  if (mode === "mismatch") {
    await assert.rejects(result, /文件名与本轮记录不一致/);
    assert.equal(directRequests, 0);
    return;
  }
  if (mode === "stop-wait") {
    await assert.rejects(result, /STOPPED_BY_USER/);
    assert.equal(waitedMs, 1000);
    assert.equal(directRequests, 0);
    return;
  }
  if (mode === "direct-blocked") {
    await assert.rejects(result, /未通过直接下载门禁/);
    assert.equal(directRequests, 1);
    assert.equal(confirmations, 0);
    return;
  }
  if (mode === "confirm-fail") {
    await assert.rejects(result, /下载完成状态无法确认/);
    assert.equal(directRequests, 1);
    assert.equal(confirmations, 1);
    return;
  }

  const rows = await result;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fileName, fileName);
  assert.equal(rows[0].id, "task-1");
  assert.equal(directRequests, mode === "resume" ? 0 : 1);
  assert.equal(confirmations, mode === "resume" ? 0 : 1);
  assert(!calls.includes("openDownloadList"));
  assert(!calls.includes("parseDownloadTasks"));
  assert(!calls.includes("closeDownloadList"));
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

async function checkTradeDirect() {
  let now = new Date(2026, 8, 30, 12, 0, 2).getTime();
  Date.now = () => now;
  const tradeFile = `MER_${merchantNo}_20260930120001_yjhx.xlsx`;
  const taskId = "20260930120001681550426941423616";
  const calls = [];
  await globalThis.CHINAUMS_DOWNLOAD_RUNNER.run({
    reportType: "trade-audit",
    merchantNo,
    startedAt: new Date(2026, 8, 30, 12, 0, 0).toISOString(),
    submittedMonths: [{ month: "2026-09", remoteFileName: tradeFile, remoteTaskId: taskId, submittedAt: "2026-09-30T04:00:00.000Z" }],
    gate: { allowed: true, merchantNo },
    checkpoint: async () => {},
    sleep: async (milliseconds) => { now += milliseconds; },
    transition: async () => {},
    invoke: async (operation, args = {}) => {
      calls.push(operation);
      if (operation === "snapshotExportTasks") {
        return { status: "found", rows: [{ id: taskId, fileName: tradeFile, statusCode: "ready", exportStatus: "02", exportStatusDesc: "成功" }] };
      }
      if (operation === "downloadTaskDirect") {
        assert.equal(args.taskId, taskId);
        assert.equal(args.fileName, tradeFile);
        return { status: "download_requested", downloadId: 1 };
      }
      if (operation === "confirmDownload") return { status: "download_completed", downloadId: 1 };
      throw new Error(operation);
    }
  });
  assert.deepEqual(calls, ["snapshotExportTasks", "downloadTaskDirect", "confirmDownload"]);
}

(async () => {
  for (const mode of ["success", "resume", "api-wait", "api-error", "mismatch", "direct-blocked",
    "confirm-fail", "stop-wait", "long-generation", "missing-id"]) {
    await checkAccount(mode);
  }
  let calls = 0;
  await assert.rejects(globalThis.CHINAUMS_DOWNLOAD_RUNNER.run({
    submittedMonths: [{ remoteFileName: fileName }, { remoteFileName: fileName }],
    startedAt: new Date().toISOString(),
    invoke: async () => { calls += 1; }
  }), /同一远端文件名/);
  assert.equal(calls, 0);
  await checkTradeDirect();
  console.log("PASS: both reports use exact API task identity, direct task downloads, and Chrome completion confirmation");
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { Date.now = originalDateNow; });
