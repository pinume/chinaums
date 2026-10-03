const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(`${__dirname}/export-runner.js`, "utf8");
const fileName = "89813015722APT1_MX_20260930170206.xlsx";

async function check(states, expectedError) {
  let now = 0;
  let searches = 0;
  const context = vm.createContext({
    Date: { now: () => now },
    activeNow: () => now, checkpoint: async () => {}, sleep: async (milliseconds) => { now += milliseconds; },
    chrome: { downloads: { search: async (query) => {
      assert.equal(query.startedAfter, "2026-09-30T09:30:00.000Z");
      const regex = new RegExp(query.filenameRegex);
      assert(regex.test(`/Downloads/${fileName}`));
      assert(regex.test(`/Downloads/${fileName.replace(".xlsx", " (1).xlsx")}`));
      assert(!regex.test(`/Downloads/other_${fileName}`));
      const item = states[Math.min(searches++, states.length - 1)];
      return item ? [item] : [];
    } } }
  });
  vm.runInContext(source.slice(source.indexOf("const waitForDownload ="), source.indexOf("const injectedAdapters =")) +
    "globalThis.confirm = waitForDownload;", context);
  const result = context.confirm({ fileName, requestedAt: "2026-09-30T09:30:00.000Z" });
  if (expectedError) await assert.rejects(result, expectedError);
  else {
    assert.equal((await result).downloadId, 7);
    assert.equal(searches, 3, "must wait for completion instead of treating creation as success");
  }
}

(async () => {
  await check([null, { id: 7, state: "in_progress" }, { id: 7, state: "complete", exists: true }]);
  await check([{ id: 7, state: "interrupted", error: "NETWORK_FAILED" }], /NETWORK_FAILED/);
  await check([{ id: 7, state: "complete", exists: false }], /已被删除/);
  await check([null], /5 分钟内未确认下载完成/);
  console.log("PASS: actual download completion, duplicate filenames, interruptions, missing files and timeout");
})().catch((error) => { console.error(error); process.exitCode = 1; });
