const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/export-runner.js`, 'utf8');
const invoke = source.slice(source.indexOf('const injectedAdapters ='), source.indexOf('const navigateToReport ='));
const limits = [];
const context = vm.createContext({
  tabId: 1, checkpoint: async () => {}, currentFrameId: async () => 1,
  withTimeout: (promise, limit, operation) => { limits.push([operation, limit]); return promise; },
  chrome: { scripting: { executeScript: async ({files, args}) => files ? [] : [{result: args.length === 1 ? true : {status:'set'}}] } }
});
vm.runInContext(`${invoke}\nglobalThis.invoke = invoke;`, context);
(async () => {
  await context.invoke('trade-audit', 'setDateRange');
  await context.invoke('account-detail', 'setDateRange');
  await context.invoke('trade-audit', 'submitExport');
  assert.deepEqual(limits, [['setDateRange',60000], ['setDateRange',15000], ['submitExport',15000]]);
  console.log('PASS: only trade calendar receives 60 seconds; other page operations retain 15 seconds');
})().catch(error => { console.error(error); process.exitCode = 1; });
