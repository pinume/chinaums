const assert = require("node:assert/strict");
require("./download-runner.js");
const originalDateNow = Date.now;

async function check(failure) {
  let now = new Date(2026, 8, 30, 12, 0, 2).getTime();
  const startedWaitingAt = now;
  Date.now = () => now;
  let opened = false;
  let opens = 0;
  let downloads = 0;
  let closing = false;
  let closeReads = 0;
  let closeAttempts = 0;
  let openingReads = 0;
  const calls = [];
  const trade = failure === "retry-close";
  const fileName = trade ? "MER_89813014812B06R_20260930120001_yjhx.xlsx" : "89813014812B06R_MX_20260930120001.xlsx";
  const secondFile = "89813014812B06R_MX_20260930120002.xlsx";
  const progressive = ["progressive", "disabled", "resume"].includes(failure);
  const fallbackAmbiguous = failure === "fallback-ambiguous";
  const clickedFiles = [];
  let awaitingCompletion = false;
  let waitingForGeneration = false;
  let waitedMs = 0;
  const generationEvents = [];
  const result = globalThis.CHINAUMS_DOWNLOAD_RUNNER.run({
    reportType: trade ? "trade-audit" : "account-detail",
    merchantNo: "89813014812B06R",
    startedAt: new Date(2026, 8, 30, 12, 0, 0).toISOString(),
    submittedMonths: [
      ...(progressive ? [{ month: "2026-08", submittedAt: "2026-09-30T03:59:00.000Z",
        remoteFileName: fileName, downloadedFileName: failure === "resume" ? fileName : null }] : []),
      { month: "2026-09", remoteFileName: ["fallback", "fallback-ambiguous"].includes(failure) ? null : progressive ? secondFile : fileName,
        submittedAt: ["fallback", "fallback-ambiguous"].includes(failure)
          ? new Date(new Date(2026, 8, 30, 12, 0, 1).getTime()).toISOString() : "2026-09-30T04:00:00.000Z" }
    ],
    gate: { allowed: true, merchantNo: "89813014812B06R" },
    checkpoint: async () => {
      if (failure === "stop-wait" && waitingForGeneration && waitedMs >= 1000) throw new Error("STOPPED_BY_USER");
    },
    sleep: async (milliseconds) => { now += milliseconds; if (waitingForGeneration) waitedMs += milliseconds; },
    transition: async (event) => {
      if (event.status === "WAITING_GENERATION") {
        generationEvents.push(event);
        if (failure === "progressive") assert.equal(event.ready, 0, "completed files must not count as ready to download");
        waitingForGeneration = true;
        assert.equal(event.remaining, (progressive ? 2 : 1) - downloads - (failure === "resume" ? 1 : 0));
        assert(event.waitedMs >= 0);
      }
    },
    invoke: async (operation, args) => {
      calls.push(operation);
      switch (operation) {
        case "query":
        case "queryState": throw new Error("Refreshing the download list must not rerun the transaction query");
        case "setDownloadPageSize": return { status: "unchanged" };
        case "openDownloadList":
          opens += 1;
          if (failure === "reopen" && opens === 2) return { status: "controls_missing" };
          openingReads = failure === "delayed-open" ? 3 : 0;
          opened = true;
          return { status: "clicked" };
        case "closeDownloadList":
          assert.equal(openingReads, 0, "must wait for the list to open before closing it");
          if (failure === "close") return { status: "blocked" };
          if (failure === "already-closed") { opened = false; return { status: "already_closed" }; }
          closeAttempts += 1;
          if (failure === "retry-close" && closeAttempts >= 4) { opened = false; closing = false; return { status: "already_closed" }; }
          closing = true;
          closeReads = 0;
          return { status: "closed" };
        case "parseDownloadTasks":
          if (failure === "never-open") return { status: "not_open" };
          if (openingReads > 0) { openingReads -= 1; return { status: "not_open" }; }
          // 模拟关闭动画；只有重新打开列表才取得服务端最新状态。
          if (closing && failure === "slow-close") now += 6000;
          if (closing && !["stuck", "retry-close"].includes(failure) && ++closeReads >= (failure === "slow-close" ? 1 : 2)) { opened = false; closing = false; }
          if (!opened) return { status: "not_found" };
          const generated = failure === "long-generation" ? now - startedWaitingAt >= 180000 : opens >= 2;
          return {
            status: "found", page: 1, total: progressive ? 2 : 1, hasNext: false,
            rows: [{ fileName, createdAt: "2026-09-30 12:00:01",
              statusCode: progressive || generated ? "ready" : "pending",
              downloadEnabled: failure === "progressive" || generated },
            ...((progressive || fallbackAmbiguous) ? [{ fileName: secondFile, createdAt: "2026-09-30 12:00:02",
              statusCode: opens >= 2 ? "ready" : "pending", downloadEnabled: opens >= 2 }] : [])]
          };
        case "downloadTask":
          assert.equal(awaitingCompletion, false, "must confirm the previous download before clicking again");
          awaitingCompletion = true;
          if (failure === "long-generation") assert(now - startedWaitingAt >= 180000);
          else assert.equal(opens, failure === "progressive" && args.fileName === fileName ? 1 : 2);
          assert.equal(closing, false);
          assert(!clickedFiles.includes(args.fileName), "must not click a file twice");
          clickedFiles.push(args.fileName);
          downloads += 1;
          return { status: "download_requested" };
        case "confirmDownload":
          assert.equal(awaitingCompletion, true);
          awaitingCompletion = false;
          return { status: "download_completed", downloadId: downloads };
        default: throw new Error(`Unexpected operation: ${operation}`);
      }
    }
  });
  if (failure === "stop-wait") {
    await assert.rejects(result, /STOPPED_BY_USER/);
    assert.equal(waitedMs, 1000);
    assert.equal(downloads, 0);
    assert.equal(opens, 1);
    return;
  }
  if (["fallback", "fallback-ambiguous"].includes(failure)) {
    await assert.rejects(result, /缺少本月已确认的远端文件名/);
    assert.equal(calls.length, 0);
    return;
  }
  if (failure && (!progressive || fallbackAmbiguous) && !["retry-close", "fallback", "delayed-open", "already-closed", "slow-close", "long-generation"].includes(failure)) {
    await assert.rejects(result, fallbackAmbiguous ? /多个候选/ : failure === "close" ? /无法关闭暂存列表/
      : failure === "stuck" ? /关闭结果无法确认/
      : failure === "never-open" ? /暂存列表打开后未能读取/ : /无法重新打开暂存列表/);
    assert.equal(downloads, 0);
    if (failure === "never-open") assert(!calls.includes("closeDownloadList"));
  } else {
    assert.equal((await result)[0].fileName, fileName);
    assert.equal(downloads, progressive && failure !== "resume" ? 2 : 1);
    if (failure === "long-generation") assert(generationEvents.some(event => event.waitedMs >= 120000));
    if (progressive) assert.deepEqual(clickedFiles, failure === "resume" ? [secondFile] : [fileName, secondFile]);
    if (failure === "progressive") assert(calls.indexOf("downloadTask") < calls.indexOf("closeDownloadList"));
    const closeIndex = calls.indexOf("closeDownloadList");
    if (failure === "retry-close") {
      assert.deepEqual(calls.slice(closeIndex, closeIndex + 8), ["closeDownloadList", "parseDownloadTasks",
        "closeDownloadList", "parseDownloadTasks", "closeDownloadList", "parseDownloadTasks",
        "closeDownloadList", "openDownloadList"]);
    } else {
      const expected = ["closeDownloadList",
        ...(failure === "already-closed" ? [] : failure === "slow-close" ? ["parseDownloadTasks"] : ["parseDownloadTasks", "parseDownloadTasks"]),
        "openDownloadList"];
      assert.deepEqual(calls.slice(closeIndex, closeIndex + expected.length), expected);
    }
  }
}

(async () => {
  await check();
  await check("close");
  await check("reopen");
  await check("stuck");
  await check("progressive");
  await check("disabled");
  await check("resume");
  await check("retry-close");
  await check("already-closed");
  await check("slow-close");
  await check("delayed-open");
  await check("never-open");
  await check("stop-wait");
  await check("long-generation");
  await check("fallback");
  await check("fallback-ambiguous");
  console.log("PASS: ready files download first without duplicates; disabled controls, ambiguous time fallback and refresh failures stay guarded");
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { Date.now = originalDateNow; });
