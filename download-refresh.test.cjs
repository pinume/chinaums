const assert = require('node:assert/strict');
require('./download-runner.js');

const originalNow = Date.now;
let now = new Date(2026, 9, 5, 12).getTime();
Date.now = () => now;

const merchantNo = '89813014812B06R';
const names = [1, 2, 3].map(n => `MER_${merchantNo}_2026100512000${n}_yjhx.xlsx`);
const ids = ['task-1', 'task-2', 'task-3'];
const submittedMonths = names.map((remoteFileName, index) => ({
  month: `2026-0${index + 1}`,
  remoteFileName,
  remoteTaskId: ids[index],
  submittedAt: `2026-10-05T04:00:0${index + 1}Z`
}));
const apiRow = (index, statusCode, extra = {}) => ({
  id: ids[index],
  fileName: names[index],
  statusCode,
  exportStatus: statusCode === 'ready' ? '02' : '01',
  exportStatusDesc: statusCode === 'ready' ? '成功' : '处理中',
  errorMsg: null,
  ...extra
});
async function run(mode = 'success') {
  let snapshotCalls = 0;
  const clicks = [], events = [];
  const result = CHINAUMS_DOWNLOAD_RUNNER.run({
    reportType: 'trade-audit',
    merchantNo,
    gate: {allowed:true, merchantNo},
    startedAt: new Date(now).toISOString(),
    submittedMonths,
    checkpoint: async () => {},
    sleep: async ms => { now += ms; },
    transition: async event => events.push(event),
    invoke: async (op, args = {}) => {
      if (op === 'snapshotExportTasks') {
        snapshotCalls++;
        assert.deepEqual(args.taskIds, ids, 'generation polling must request only this run task IDs');
        if (mode === 'api-error') return {status:'error', reason:'temporary failure'};
        if (mode === 'failed') {
          return {status:'found', rows:[apiRow(0, 'failed', {exportStatus:'03', exportStatusDesc:'失败', errorMsg:'生成失败'})]};
        }
        if (mode === 'mismatch') {
          return {status:'found', rows:[{...apiRow(0, 'ready'), fileName:names[1]}]};
        }
        if (snapshotCalls === 1) return {status:'found', rows:[apiRow(0, 'ready'), apiRow(1, 'pending')]};
        if (snapshotCalls === 2) return {status:'found', rows:[apiRow(0, 'ready'), apiRow(1, 'ready'), apiRow(2, 'pending', {exportStatus:'99', exportStatusDesc:'未知'})]};
        return {status:'found', rows:[apiRow(0, 'ready'), apiRow(1, 'ready'), apiRow(2, 'ready')]};
      }
      if (op === 'downloadTaskDirect') {
        assert.equal(mode, 'success');
        assert.equal(snapshotCalls, 3, 'must not download before every API task is ready');
        assert(!clicks.includes(args.fileName));
        assert.equal(args.taskId, ids[clicks.length]);
        clicks.push(args.fileName);
        return {status:'download_requested'};
      }
      if (op === 'confirmDownload') return {status:'download_completed', downloadId:clicks.length};
      throw new Error(op);
    }
  });

  if (mode === 'api-error') {
    await assert.rejects(result, /暂存接口连续 3 次读取失败/);
    assert.equal(snapshotCalls, 3);
    assert.equal(clicks.length, 0);
    return;
  }
  if (mode === 'failed') {
    await assert.rejects(result, /生成失败/);
    assert.equal(clicks.length, 0);
    return;
  }
  if (mode === 'mismatch') {
    await assert.rejects(result, /非本轮任务 ID|文件名与本轮记录不一致/);
    assert.equal(clicks.length, 0);
    return;
  }

  const rows = await result;
  assert.equal(snapshotCalls, 3);
  assert.deepEqual(clicks, names);
  assert.equal(rows.length, 3);
  const waiting = events.filter(event => event.status === 'WAITING_GENERATION');
  assert.deepEqual(waiting.map(event => [event.found, event.ready, event.remaining]), [[2,1,2],[3,2,1]]);
}

(async () => {
  await run();
  await run('api-error');
  await run('failed');
  await run('mismatch');
  console.log('PASS: trade generation polls exact task IDs, tolerates unknown states, then downloads directly and stops on API or identity failures');
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { Date.now = originalNow; });
