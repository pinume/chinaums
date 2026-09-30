const assert = require("node:assert/strict");
require("./download-runner.js");
const originalDateNow = Date.now;

async function check(failure) {
  let now = new Date(2026, 8, 30, 12, 0, 2).getTime();
  Date.now = () => now;
  let opened = false;
  let opens = 0;
  let downloads = 0;
  let closing = false;
  let closeReads = 0;
  let openingReads = 0;
  const calls = [];
  const fileName = failure === "trade-refresh" ? "MER_89813014812B06R_20260930120001_yjhx.xlsx" : "89813014812B06R_MX_20260930120001.xlsx";
  const secondFile = "89813014812B06R_MX_20260930120002.xlsx";
  const progressive = ["progressive", "disabled", "resume"].includes(failure);
  const clickedFiles = [];
  let lastClickAt = null;
  let awaitingCompletion = false;
  const result = globalThis.CHINAUMS_DOWNLOAD_RUNNER.run({
    reportType: failure === "trade-refresh" ? "trade-audit" : "account-detail",
    merchantNo: "89813014812B06R",
    startedAt: new Date(2026, 8, 30, 12, 0, 0).toISOString(),
    submittedMonths: [
      ...(progressive ? [{ month: "2026-08", submittedAt: "2026-09-30T03:59:00.000Z",
        downloadedFileName: failure === "resume" ? fileName : null }] : []),
      { month: "2026-09", submittedAt: "2026-09-30T04:00:00.000Z" }
    ],
    gate: { allowed: true, merchantNo: "89813014812B06R" },
    checkpoint: async () => {},
    sleep: async (milliseconds) => { now += milliseconds; },
    transition: async () => {},
    invoke: async (operation, args) => {
      calls.push(operation);
      switch (operation) {
        case "query": assert.equal(opened, false); return { status: "clicked" };
        case "queryState": assert.equal(args.refreshDownloadList, true); return { status: "ready" };
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
          closing = true;
          closeReads = 0;
          return { status: "closed" };
        case "parseDownloadTasks":
          if (failure === "never-open") return { status: "not_open" };
          if (openingReads > 0) { openingReads -= 1; return { status: "not_open" }; }
          // 模拟关闭动画；只有重新打开列表才取得服务端最新状态。
          if (closing && failure === "slow-close") now += 6000;
          if (closing && failure !== "stuck" && ++closeReads >= (failure === "slow-close" ? 1 : 2)) { opened = false; closing = false; }
          if (!opened) return { status: "not_found" };
          return {
            status: "found", page: 1, total: progressive ? 2 : 1, hasNext: false,
            rows: [{ fileName, createdAt: "2026-09-30 12:00:01",
              statusCode: progressive || opens >= 2 ? "ready" : "pending",
              downloadEnabled: failure === "progressive" || opens >= 2 },
            ...(progressive ? [{ fileName: secondFile, createdAt: "2026-09-30 12:00:02",
              statusCode: opens >= 2 ? "ready" : "pending", downloadEnabled: opens >= 2 }] : [])]
          };
        case "downloadTask":
          assert.equal(awaitingCompletion, false, "must confirm the previous download before clicking again");
          awaitingCompletion = true;
          if (lastClickAt !== null) assert(now - lastClickAt >= 5000, "download clicks must be paced");
          lastClickAt = now;
          assert.equal(opens, failure === "progressive" && args.fileName === fileName ? 1 : 2);
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
  if (failure && !progressive && !["trade-refresh", "delayed-open", "already-closed", "slow-close"].includes(failure)) {
    await assert.rejects(result, failure === "close" ? /无法关闭暂存列表/
      : failure === "stuck" ? /关闭结果无法确认/
      : failure === "never-open" ? /暂存列表打开后未能读取/ : /无法重新打开暂存列表/);
    assert.equal(downloads, 0);
    if (failure === "never-open") assert(!calls.includes("closeDownloadList"));
  } else {
    assert.equal((await result)[0].fileName, fileName);
    assert.equal(downloads, progressive && failure !== "resume" ? 2 : 1);
    if (progressive) assert.deepEqual(clickedFiles, failure === "resume" ? [secondFile] : [fileName, secondFile]);
    if (failure === "progressive") assert(calls.indexOf("downloadTask") < calls.indexOf("closeDownloadList"));
    const closeIndex = calls.indexOf("closeDownloadList");
    const expected = ["closeDownloadList",
      ...(failure === "already-closed" ? [] : failure === "slow-close" ? ["parseDownloadTasks"] : failure === "trade-refresh" ? ["parseDownloadTasks", "closeDownloadList", "parseDownloadTasks", "closeDownloadList", "parseDownloadTasks", "parseDownloadTasks"] : ["parseDownloadTasks", "parseDownloadTasks"]),
      ...(failure === "trade-refresh" ? ["query", "queryState"] : []), "openDownloadList"];
    assert.deepEqual(calls.slice(closeIndex, closeIndex + expected.length), expected);
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
  await check("trade-refresh");
  await check("already-closed");
  await check("slow-close");
  await check("delayed-open");
  await check("never-open");
  console.log("PASS: ready files download first without duplicates; disabled controls and refresh failures stay guarded");
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { Date.now = originalDateNow; });
