const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/export-runner.js`, 'utf8');
const invoke = source.slice(source.indexOf('const injectedAdapters ='), source.indexOf('const navigateToReport ='));
const limits = [];
let now = 1000;
class Clock extends Date { static now() { return now; } }
const context = vm.createContext({
  Date: Clock, tabId: 1, checkpoint: async () => {}, currentFrameId: async () => 1,
  withTimeout: (promise, limit, operation) => { limits.push([operation, limit]); return promise; },
  chrome: { scripting: { executeScript: async ({files, args}) => files ? [] : [{result: args.length === 1 ? true : {status:'set'}}] } }
});
vm.runInContext(`${invoke}\nglobalThis.invoke = invoke;`, context);
(async () => {
  await context.invoke('trade-audit', 'setDateRange');
  await context.invoke('account-detail', 'setDateRange');
  await context.invoke('trade-audit', 'query');
  await context.invoke('trade-audit', 'submitExport');
  assert.deepEqual(limits, [['setDateRange',15000], ['setDateRange',15000], ['query',60000], ['submitExport',60000]]);
  limits.length = 0;
  await context.invoke('trade-audit', 'snapshotExportTasks', {operationDeadline: now + 2000});
  assert.deepEqual(limits, [['snapshotExportTasks',2000]]);
  let adapterCalls = 0;
  context.chrome.scripting.executeScript = async () => { adapterCalls++; return []; };
  context.currentFrameId = async () => { now += 3000; return 1; };
  await assert.rejects(context.invoke('trade-audit','snapshotExportTasks',{operationDeadline:now+2000}), /截止时间/);
  assert.equal(adapterCalls,0,'expired frame lookup must not launch an adapter');
  console.log('PASS: paginated trade query/submit identity checks receive 60 seconds; ordinary page operations retain 15 seconds');
})().catch(error => { console.error(error); process.exitCode = 1; });

