const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const merchantNo = '89813014812B1L3';
const fileName = `MER_${merchantNo}_20260930120001_yjhx.xlsx`;
const otherFile = `MER_${merchantNo}_20260930120002_yjhx.xlsx`;
let now = new Date(2026, 8, 30, 12, 0, 1).getTime();
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const context = vm.createContext({ Date: Clock, reportType: 'trade-audit', tabId: 1,
  normalize: value => String(value || '').toUpperCase(), state: {months: {}},
  checkpoint: async () => {}, sleep: async ms => { now += ms; }
});
for (const file of ['monthly-runner.js', 'download-runner.js']) {
  vm.runInContext(fs.readFileSync(`${__dirname}/${file}`, 'utf8'), context);
}
const source = fs.readFileSync(`${__dirname}/export-runner.js`, 'utf8');
vm.runInContext(source.slice(source.indexOf('const parsePortalTimestamp ='), source.indexOf('const closeExistingSubmitNotice =')) + '\nglobalThis.reconcile = reconcileUnknown;', context);
const month = {key: '2026-01', start: '2026-01-01', end: '2026-01-31'};

async function reconcile(mode) {
  now = new Date(2026, 8, 30, 12, 0, 1).getTime();
  let page = 2;
  const visited = [];
  context.state = {months: {}};
  context.invoke = async (_, operation, args) => {
    if (operation === 'classifySubmit') return mode === 'bound' ? {status: 'accepted', fileName} : {status: 'unknown'};
    if (operation === 'closeSubmitDialog') return {status: 'closed'};
    if (operation === 'openDownloadList') { assert.equal(args.targetMerchantNo, merchantNo); return {status: 'clicked'}; }
    if (operation === 'closeDownloadList') return {status: 'closed'};
    if (operation === 'selectDownloadPage') { page = args.page; return {status: 'clicked'}; }
    if (operation === 'nextDownloadPage') {
      if (mode === 'failed-page') return {status: 'blocked'};
      if (mode !== 'stuck-page') page++;
      return {status: 'clicked'};
    }
    if (operation === 'parseDownloadTasks') {
      visited.push(page);
      return {status: 'found', page, hasNext: page === 1,
        rows: page === 1 ? [{fileName, createdAt: mode === 'bound' ? '2026-09-30 12:00:30' : '2026-09-30 12:00:01'}]
          : mode === 'multiple' ? [{fileName: otherFile, createdAt: '2026-09-30 12:00:02'}] : mode === 'duplicate' ? [{fileName, createdAt: '2026-09-30 12:00:01'}] : []};
    }
    throw new Error(operation);
  };
  const result = await context.reconcile({attemptedAt: new Clock().toISOString(), targetMerchantNo: merchantNo, gate: {allowed: true, merchantNo}});
  assert(visited.includes(1));
  if (mode === 'bound') { assert.equal(result.status, 'accepted'); assert.equal(result.fileName, fileName); }
  else assert.equal(result.status, 'unknown', mode);
  if (['bound', 'multiple', 'duplicate', 'unbound'].includes(mode)) assert.equal(visited.at(-1), 2, 'must finish scanning all pages');
}

async function monthly(mode) {
  let submits = 0;
  let reconciles = 0;
  let savedAttempt = false;
  const events = [];
  const result = context.CHINAUMS_MONTHLY_RUNNER.run({
    months: mode === 'switch' ? [month, {...month, key: '2026-02'}] : [month], gate: {},
    checkpoint: async () => {}, sleep: async ms => { now += ms; },
    transition: async event => { events.push(event); if (event.status === 'SUBMITTING') savedAttempt = Boolean(event.attemptedAt); },
    reconcileUnknown: async args => {
      reconciles++;
      assert(savedAttempt);
      assert.equal(args.targetMerchantNo, merchantNo);
      if (mode === 'reconcile-error') throw new Error('list timeout');
      return {status: 'accepted', fileName};
    },
    invoke: async operation => {
      if (operation === 'setDateRange') return {status: 'set'};
      if (operation === 'query') return {status: 'clicked'};
      if (operation === 'queryState') return {status: 'ready', count: 1, merchantId: mode === 'missing-merchant' ? null : 'internal-id',
        merchantNo: mode === 'missing-merchant' ? null : mode === 'switch' && submits ? 'OTHER' : merchantNo};
      if (operation === 'snapshotExportTasks') return {status:'found',rows:submits ? [{id:'new-task',fileName}] : []};
      if (operation === 'submitExport') {
        submits++;
        assert(savedAttempt, 'attempt must be saved before side effect');
        if (['submit-timeout', 'reconcile-error'].includes(mode)) throw new Error('timeout');
        return {status: mode === 'blocked' ? 'blocked' : 'clicked'};
      }
      if (operation === 'classifySubmit') {
        if (mode === 'response-timeout') throw new Error('timeout');
        return {status: 'accepted', fileName};
      }
      if (operation === 'closeSubmitDialog') return {status: 'closed'};
      throw new Error(operation);
    }
  });
  if (['switch', 'missing-merchant', 'blocked', 'reconcile-error'].includes(mode)) {
    await assert.rejects(result);
    assert.equal(submits, mode === 'missing-merchant' ? 0 : 1);
    assert.equal(events.at(-1).status, mode === 'reconcile-error' ? 'UNKNOWN' : 'FAILED');
  } else {
    const results = await result;
    assert.equal(results[0].status, 'SUBMITTED');
    assert.equal(results[0].remoteFileName, fileName);
    assert.equal(submits, 1);
  }
  assert.equal(reconciles, ['submit-timeout', 'response-timeout', 'reconcile-error'].includes(mode) ? 1 : 0);
}

(async () => {
  for (const mode of ['bound', 'unbound', 'multiple', 'duplicate', 'failed-page', 'stuck-page']) await reconcile(mode);
  for (const mode of ['normal', 'submit-timeout', 'response-timeout', 'reconcile-error', 'switch', 'missing-merchant', 'blocked']) await monthly(mode);
  for (const names of [[fileName, null], [fileName, fileName]]) {
    let calls = 0;
    const submittedMonths = names.map(remoteFileName => ({remoteFileName}));
    await assert.rejects(context.CHINAUMS_DOWNLOAD_RUNNER.run({
      submittedMonths, startedAt: new Clock().toISOString(), merchantNo,
      invoke: async () => { calls++; }
    }), names[1] ? /同一远端文件名/ : /缺少本月已确认的远端文件名/);
    assert.equal(calls, 0, 'missing identity and timestamp must stop before opening or clicking');
  }
  const guard = source.slice(source.indexOf('  if (reportType === "trade-audit" && new Date().getFullYear()'), source.indexOf('  const months = globalThis.CHINAUMS_MONTHLY_RUNNER.yearToDateMonths();'));
  now = new Date(2027, 0, 1).getTime();
  assert.throws(() => vm.runInContext(guard, context), /当前仅适配 2026/);
  context.reportType = 'account-detail';
  vm.runInContext(guard, context);
  console.log('PASS: exact task identity, complete reconciliation pagination, submission timeouts, merchant lock and 2026 gate');
})().catch(error => { console.error(error); process.exitCode = 1; });
