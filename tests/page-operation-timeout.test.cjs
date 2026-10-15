const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/../browser-runner.js`, 'utf8');
const limits = [];
let now = 1000;
class Clock extends Date { static now() { return now; } }
const context = vm.createContext({
  Date: Clock,
  window: { setTimeout: (_, limit) => { limits.push(limit); return 1; }, clearTimeout() {} },
  chrome: { scripting: { executeScript: async ({files, args}) => files ? [] : [{result: args.length === 1 ? true : {status:'set'}}] } }
});
vm.runInContext(source, context);
const invoke = context.CHINAUMS_BROWSER_RUNNER.create({
  chrome: context.chrome, host: "service.chinaums.com", tabId: 1,
  checkpoint: async () => {}, sleep: async () => {}, now: () => now
});
(async () => {
  await invoke('trade-audit', 'snapshotExportTasks');
  await invoke('account-detail', 'snapshotExportTasks');
  await invoke('trade-audit', 'query');
  await invoke('trade-audit', 'submitExport');
  await invoke('account-detail', 'query');
  await invoke('account-detail', 'submitExport');
  assert.deepEqual(limits, [15000, 15000, 60000, 60000, 60000, 60000]);
  limits.length = 0;
  await invoke('trade-audit', 'snapshotExportTasks', {operationDeadline: now + 2000});
  assert.deepEqual(limits, [2000]);
  let adapterCalls = 0;
  context.chrome.scripting.executeScript = async () => { adapterCalls++; now += 3000; return []; };
  await assert.rejects(invoke('trade-audit','snapshotExportTasks',{operationDeadline:now+2000}), /截止时间/);
  assert.equal(adapterCalls,1,'expired adapter availability check must not launch the next operation');
  console.log('PASS: paginated report query/submit identity checks receive 60 seconds; ordinary page operations retain 15 seconds');
})().catch(error => { console.error(error); process.exitCode = 1; });
