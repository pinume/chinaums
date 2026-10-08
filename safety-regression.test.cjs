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
  activeNow: () => now, checkpoint: async () => {}, sleep: async ms => { now += ms; }
});
for (const file of ['monthly-runner.js', 'download-runner.js']) {
  vm.runInContext(fs.readFileSync(`${__dirname}/${file}`, 'utf8'), context);
}
const source = fs.readFileSync(`${__dirname}/export-runner.js`, 'utf8');
const month = {key: '2026-01', start: '2026-01-01', end: '2026-01-31'};

async function reconcile(mode) {
  now = new Date(2026, 8, 30, 12, 0, 1).getTime();
  const baselineId = '11111111111111111111111111111111';
  const taskId = '20260930120002681550426941423616';
  const calls = [];
  let submits = 0;
  let needsBaseline = false;
  const events = [];
  const baselineRows = mode === 'duplicate-baseline'
    ? [{id:baselineId}, {id:baselineId}]
    : [{id:baselineId}];
  const invoke = async operation => {
    if (operation === 'query') { needsBaseline = true; return {status:'ready', count:1, merchantNo, merchantId:'internal-id'}; }
    if (operation === 'submitExport') { submits++; return {status:'unknown'}; }
    if (needsBaseline) { needsBaseline = false; return {status:'found', rows:baselineRows}; }
    calls.push(operation);
    assert.equal(operation, 'snapshotExportTasks', 'trade UNKNOWN reconciliation must not use dialog or download-list UI');
    if (mode === 'read-error') throw new Error('temporary API failure');
    const rows = mode === 'no-new' ? [{
      id: baselineId, fileName: `MER_${merchantNo}_20260930110000_yjhx.xlsx`, createdAt: '2026-09-30 11:00:00'
    }] : [{
      id: taskId,
      fileName: mode === 'merchant-mismatch'
        ? 'MER_OTHER_20260930120002_yjhx.xlsx'
        : fileName.replace('120001', '120002'),
      createdAt: mode === 'old-task' ? '2026-09-30 11:59:00' : '2026-09-30 12:00:02'
    }];
    if (mode === 'bad-id') rows[0].id = 'bad-id';
    if (mode === 'multiple') rows.push({
      id: '20260930120003681550426941423617',
      fileName: otherFile.replace('120002', '120003'),
      createdAt: '2026-09-30 12:00:03'
    });
    return {status:'found', rows};
  };
  const run = context.CHINAUMS_MONTHLY_RUNNER.run({
    months:mode === 'already-bound' ? [month, {...month, key:'2026-02'}] : [month], reportType:'trade-audit', gate:{}, invoke,
    checkpoint:async()=>{}, sleep:async ms=>{now+=ms;}, now:()=>now,
    transition:async event=>events.push({...event})
  });
  let result;
  if (mode === 'accepted') result = (await run)[0];
  else { await assert.rejects(run, /UNKNOWN/); result = events.at(-1); }
  assert.equal(submits, mode === 'already-bound' ? 2 : 1, 'UNKNOWN must never replay a submission');
  if (mode === 'accepted') {
    assert.equal(result.status, 'SUBMITTED');
    assert.equal(result.remoteTaskId, taskId);
    assert.equal(result.remoteFileName, fileName.replace('120001', '120002'));
    assert.deepEqual(calls, ['snapshotExportTasks']);
  } else {
    assert.equal(result.status, 'UNKNOWN', mode);
    if (mode === 'already-bound') assert.match(result.reason, /身份校验未通过/);
    if (['read-error', 'no-new'].includes(mode)) {
      assert(now - new Date(2026, 8, 30, 12, 0, 1).getTime() >= 15000);
    }
    if (mode === 'duplicate-baseline') assert.equal(calls.length, 0);
  }
}

async function monthly(mode) {
  let submits = 0;
  let reconciles = 0;
  let savedAttempt = false;
  const events = [];
  const result = context.CHINAUMS_MONTHLY_RUNNER.run({
    reportType: 'trade-audit',
    months: mode === 'switch' ? [month, {...month, key: '2026-02'}] : [month], gate: {},
    checkpoint: async () => {}, sleep: async ms => { now += ms; },
    transition: async event => { events.push(event); if (event.status === 'SUBMITTING') savedAttempt = Boolean(event.attemptedAt); },
    invoke: async operation => {
      if (operation === 'query') {
        if (mode === 'stop-query') throw new Error('STOPPED_BY_USER');
        return {status: 'ready', count: 1, merchantId: mode === 'missing-merchant' ? null : 'internal-id',
          merchantNo: mode === 'missing-merchant' ? null : mode === 'switch' && submits ? 'OTHER' : merchantNo};
      }
      if (operation === 'snapshotExportTasks') {
        if (submits && ['submit-timeout', 'reconcile-error', 'stop-reconcile'].includes(mode)) {
          reconciles++;
          assert(savedAttempt);
          if (mode === 'stop-reconcile') throw new Error('STOPPED_BY_USER');
          if (mode === 'reconcile-error') throw new Error('snapshot timeout');
        }
        return {status:'found',rows:submits ? [{id:'20260930120002681550426941423616',fileName,
          createdAt:new Clock().toISOString().slice(0,19).replace('T',' ')}] : []};
      }
      if (operation === 'submitExport') {
        submits++;
        assert(savedAttempt, 'attempt must be saved before side effect');
        if (mode === 'stop-submit') throw new Error('STOPPED_BY_USER');
        if (['submit-timeout', 'reconcile-error', 'stop-reconcile'].includes(mode)) throw new Error('timeout');
        return mode === 'blocked' ? {status: 'blocked'} : {status: 'accepted', fileName};
      }
      if (operation === 'closeSubmitDialog') return {status: 'closed'};
      throw new Error(operation);
    }
  });
  if (mode.startsWith('stop-')) {
    await assert.rejects(result, /^Error: STOPPED_BY_USER$/);
    assert.equal(submits, mode === 'stop-query' ? 0 : 1);
    assert(!events.some(event => ['FAILED', 'SUBMITTED'].includes(event.status)), 'user cancellation must not become failure or acceptance');
  } else if (['switch', 'missing-merchant', 'blocked', 'reconcile-error'].includes(mode)) {
    await assert.rejects(result);
    assert.equal(submits, mode === 'missing-merchant' ? 0 : 1);
    assert.equal(events.at(-1).status, mode === 'reconcile-error' ? 'UNKNOWN' : 'FAILED');
  } else {
    const results = await result;
    assert.equal(results[0].status, 'SUBMITTED');
    assert.equal(results[0].remoteFileName, fileName);
    if (mode === 'submit-timeout') {
      assert.equal(results[0].remoteTaskId, '20260930120002681550426941423616');
    }
    assert.equal(submits, 1);
  }
  if (mode === 'reconcile-error') assert(reconciles > 0);
  else assert.equal(reconciles, ['submit-timeout', 'stop-reconcile'].includes(mode) ? 1 : 0);
}

async function retentionStopsBeforeDownload() {
  let calls = 0;
  await assert.rejects(context.CHINAUMS_DOWNLOAD_RUNNER.run({
    reportType: 'trade-audit', merchantNo, gate: {allowed: true, merchantNo},
    startedAt: new Clock(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
    submittedMonths: [{month: month.key, remoteFileName: fileName, remoteTaskId: 'task-1', submittedAt: new Clock().toISOString()}],
    checkpoint: async () => {}, sleep: async ms => {now += ms;}, transition: async () => {},
    invoke: async () => { calls++; throw new Error('retention guard must stop before remote reads or downloads'); }
  }), /暂存文件保留期限/);
  assert.equal(calls, 0);
}

(async () => {
  for (const mode of ['accepted', 'multiple', 'merchant-mismatch', 'bad-id', 'old-task', 'no-new', 'read-error', 'duplicate-baseline', 'already-bound']) await reconcile(mode);
  for (const mode of ['normal', 'submit-timeout', 'reconcile-error', 'switch', 'missing-merchant', 'blocked', 'stop-query', 'stop-submit', 'stop-reconcile']) await monthly(mode);
  await retentionStopsBeforeDownload();
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
  console.log('PASS: exact task identity, UNKNOWN safety, retention guard, user cancellation, merchant lock and 2026 gate');
})().catch(error => { console.error(error); process.exitCode = 1; });
