const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const setupContext = ({ onQuery, onSubmit }) => {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      listeners: {}, attributes: {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
      setAttribute(name, value) { this.attributes[name] = value; },
      append() {}, scrollIntoView() {}
    });
    return elements.get(selector);
  };

  let complete;
  const completed = new Promise((resolve) => { complete = resolve; });

  const context = vm.createContext({
    URL, URLSearchParams, Date, Intl,
    location: { search: "?tabId=1&reportType=trade-audit" },
    window: { setTimeout, clearTimeout },
    document: { querySelector: element, createElement: element }
  });

  vm.runInContext(fs.readFileSync(`${__dirname}/../site-config.js`, "utf8"), context);
  vm.runInContext(fs.readFileSync(`${__dirname}/../monthly-runner.js`, "utf8"), context);

  const merchantNo = "89813014812B1L3";
  context.CHINAUMS_AUTH = { classify: () => ({ status: "logged_in", confidence: "high" }) };

  const tab = { id: 1, url: "https://service.chinaums.com/uisportal/index_r", status: "complete" };
  const remoteTasks = [];
  let submitCount = 0;

  context.chrome = {
    tabs: {
      update: async () => {},
      get: async () => tab,
      getCurrent: async () => ({ id: 2 }),
      remove: async () => {}
    },
    runtime: { getURL: (path) => `chrome-extension://test/${path}` },
    storage: {
      local: {
        get: async () => ({ activeExportRun: null }),
        set: async (value) => {
          if (["COMPLETED", "BLOCKED", "STOPPED"].includes(value.activeExportRun?.status)) {
            complete(value.activeExportRun);
          }
        }
      }
    },
    scripting: {
      executeScript: async ({ args, files }) => {
        if (files) return [];
        if (args[0]?.reportType) return [{ frameId: 0, result: { isReportFrame: true } }];
        if (typeof args[0] === "object") return [{ result: { isTopFrame: true, url: tab.url } }];
        if (args.length === 1) return [{ result: true }];

        const operation = args[1];
        const opArgs = args[2] || {};

        if (operation === "query") {
          return [{ result: onQuery(opArgs) }];
        }
        if (operation === "snapshotExportTasks") {
          return [{ result: { status: "found", rows: remoteTasks.map(t => ({ ...t })) } }];
        }
        if (operation === "submitExport") {
          const res = onSubmit(opArgs);
          if (res.status === "accepted") {
            submitCount++;
            const taskId = String(submitCount).padStart(32, "0");
            const fileName = `MER_${merchantNo}_2026100800${String(submitCount).padStart(4, "0")}_yjhx.xlsx`;
            remoteTasks.push({
              id: taskId,
              fileName,
              exportStatus: "02",
              exportStatusDesc: "成功",
              createdAt: new Date().toISOString().slice(0, 19).replace("T", " ")
            });
            return [{ result: { status: "accepted", taskId, fileName } }];
          }
          return [{ result: res }];
        }
        return [{ result: { status: "unknown" } }];
      }
    }
  };

  context.CHINAUMS_DOWNLOAD_RUNNER = {
    run: async (args) => {
      await args.onMerchantIdentified(merchantNo);
      for (const item of args.submittedMonths) {
        await args.transition({
          status: "DOWNLOAD_COMPLETED",
          month: item.month,
          fileName: item.remoteFileName,
          downloadId: 1
        });
      }
    }
  };

  vm.runInContext(fs.readFileSync(`${__dirname}/../export-runner.js`, "utf8"), context);

  return { completed, elements };
};

async function testHappyPathFullYear() {
  const queryRanges = [];
  const { completed } = setupContext({
    onQuery: (args) => {
      queryRanges.push(`${args.start}至${args.end}`);
      return { status: "ready", count: 7573, merchantId: "internal-id", merchantNo: "89813014812B1L3" };
    },
    onSubmit: () => ({ status: "accepted" })
  });

  const state = await completed;
  assert.equal(state.status, "COMPLETED");
  assert.equal(queryRanges.length, 1, "优先执行一次全年查询");
  assert.match(queryRanges[0], /^2026-01-01至/);
  assert.equal(Object.keys(state.months).length, 1);
  assert.equal(state.monthOrder[0], "2026全年");
  assert.equal(state.months["2026全年"].status, "SUBMITTED");
  assert(state.logs.some(l => l.includes("优先尝试全年导出")));
  console.log("PASS: trade-audit full-year export succeeds on happy path");
}

async function testQueryFailureFallback() {
  const queryRanges = [];
  let queryCount = 0;
  const { completed } = setupContext({
    onQuery: (args) => {
      queryCount++;
      queryRanges.push(`${args.start}至${args.end}`);
      if (queryCount === 1) {
        // 全年查询被后端限制
        return { status: "failed", reason: "交易日期间隔不能超过35天" };
      }
      // 兜底按月查询成功
      return { status: "ready", count: 100, merchantId: "internal-id", merchantNo: "89813014812B1L3" };
    },
    onSubmit: () => ({ status: "accepted" })
  });

  const state = await completed;
  assert.equal(state.status, "COMPLETED");
  assert(queryRanges.length > 1, "全年失败后切换为按月查询");
  assert.match(queryRanges[0], /^2026-01-01至/);
  assert(state.monthOrder.length > 1, "回退后 monthOrder 为逐月");
  assert(state.logs.some(l => l.includes("全年导出未成功") && l.includes("切换为按月导出")));
  console.log("PASS: trade-audit query failure triggers fallback to monthly export");
}

async function testSubmitFailureFallback() {
  let submitAttempts = 0;
  const { completed } = setupContext({
    onQuery: () => ({ status: "ready", count: 100, merchantId: "internal-id", merchantNo: "89813014812B1L3" }),
    onSubmit: () => {
      submitAttempts++;
      if (submitAttempts === 1) {
        // 全年提交申请被后端限制
        return { status: "failed", message: "导出跨度超限，服务端拒绝" };
      }
      return { status: "accepted" };
    }
  });

  const state = await completed;
  assert.equal(state.status, "COMPLETED");
  assert(submitAttempts > 1, "全年提交失败后切换为按月提交");
  assert(state.logs.some(l => l.includes("触发兜底，切换为按月导出")));
  console.log("PASS: trade-audit submit failure triggers fallback to monthly export");
}

(async () => {
  await testHappyPathFullYear();
  await testQueryFailureFallback();
  await testSubmitFailureFallback();
  console.log("PASS: trade fallback test suite passed completely");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
