const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/../export-runner.js`, 'utf8');
const invoke = source.slice(source.indexOf('const injectedAdapters ='), source.indexOf('const run ='));
const limits = [];
let now = 1000;
class Clock extends Date { static now() { return now; } }
const context = vm.createContext({
  Date: Clock, tabId: 1, checkpoint: async () => {},
  withTimeout: (promise, limit, operation) => { limits.push([operation, limit]); return promise; },
  chrome: { scripting: { executeScript: async ({files, args}) => files ? [] : [{result: args.length === 1 ? true : {status:'set'}}] } }
});
vm.runInContext(`${invoke}\nglobalThis.invoke = invoke;`, context);
(async () => {
  await context.invoke('trade-audit', 'snapshotExportTasks');
  await context.invoke('account-detail', 'snapshotExportTasks');
  await context.invoke('trade-audit', 'query');
  await context.invoke('trade-audit', 'submitExport');
  await context.invoke('account-detail', 'query');
  await context.invoke('account-detail', 'submitExport');
  assert.deepEqual(limits, [
    ['snapshotExportTasks',15000], ['snapshotExportTasks',15000],
    ['query',60000], ['submitExport',60000], ['query',60000], ['submitExport',60000]
  ]);
  limits.length = 0;
  await context.invoke('trade-audit', 'snapshotExportTasks', {operationDeadline: now + 2000});
  assert.deepEqual(limits, [['snapshotExportTasks',2000]]);
  let adapterCalls = 0;
  context.chrome.scripting.executeScript = async () => { adapterCalls++; now += 3000; return []; };
  await assert.rejects(context.invoke('trade-audit','snapshotExportTasks',{operationDeadline:now+2000}), /截止时间/);
  assert.equal(adapterCalls,1,'expired adapter availability check must not launch the next operation');
  console.log('PASS: paginated report query/submit identity checks receive 60 seconds; ordinary page operations retain 15 seconds');
})().catch(error => { console.error(error); process.exitCode = 1; });
