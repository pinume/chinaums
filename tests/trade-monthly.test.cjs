const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({Date});
vm.runInContext(fs.readFileSync(__dirname + '/../monthly-runner.js', 'utf8'), context);
const yearToDate = context.CHINAUMS_MONTHLY_RUNNER.yearToDateMonths;
const january = yearToDate(new Date(2026, 0, 1));
assert.equal(january.length, 1); assert.equal(january[0].end, '2026-01-01');
const leap = yearToDate(new Date(2024, 2, 15));
assert.equal(leap[1].end, '2024-02-29'); assert.equal(leap[2].end, '2024-03-15');
const december = yearToDate(new Date(2026, 11, 31));
assert.equal(december.length, 12); assert.equal(december[11].end, '2026-12-31');

const fullYear = context.CHINAUMS_MONTHLY_RUNNER.fullYearRange;
const full2026 = fullYear(new Date(2026, 9, 8));
assert.equal(full2026.length, 1);
assert.equal(full2026[0].key, '2026全年');
assert.equal(full2026[0].start, '2026-01-01');
assert.equal(full2026[0].end, '2026-10-08');
const fullDec = fullYear(new Date(2026, 11, 31));
assert.equal(fullDec[0].end, '2026-12-31');

const months = [{key: '2026-01', start: '2026-01-01', end: '2026-01-31'}, {key: '2026-02', start: '2026-02-01', end: '2026-02-28'}];
async function run() {
  const calls = [];
  let submitted = 0;
  const tasks = [];
  await context.CHINAUMS_MONTHLY_RUNNER.run({
    months, gate:{authentication:{status:'logged_in',confidence:'high'}},
    checkpoint:async()=>{},sleep:async()=>{},transition:async()=>{},
    invoke:async operation=>{
      calls.push(operation);
      if(operation==='snapshotExportTasks')return{status:'found',rows:[...tasks]};
      if(operation==='submitExport'){
        submitted++;
        tasks.push({id:String(submitted),fileName:`89813014812B1L3_MX_2026093012000${submitted}.xlsx`});
        return{status:'accepted'};
      }
      if(operation==='query')return{status:'ready',count:132,merchantNo:'89813014812B1L3'};
      throw new Error(operation);
    }
  });
  assert.deepEqual(calls, Array(2).fill(['query','snapshotExportTasks','submitExport','snapshotExportTasks']).flat());
  const emptyEvents = [];
  await context.CHINAUMS_MONTHLY_RUNNER.run({
    months, gate: {},
    checkpoint: async () => {}, sleep: async () => {}, transition: async event => emptyEvents.push(event),
    invoke: async operation => {
      if (operation === 'query') return {status:'no_data',count:0};
      throw new Error(`empty month must not export: ${operation}`);
    }
  });
  assert.equal(emptyEvents.filter(event => event.status === 'NO_DATA').length, months.length);
  for (const outcome of ['failed', 'waiting', 'timeout', 'stop-after-query']) {
    let queries = 0, stopped = false;
    const failedEvents = [];
    await assert.rejects(context.CHINAUMS_MONTHLY_RUNNER.run({
      months: [months[0]], gate: {}, sleep: async () => {},
      checkpoint: async () => { if (stopped) throw new Error('STOPPED_BY_USER'); },
      transition: async event => failedEvents.push(event),
      invoke: async (operation, args) => {
        assert.equal(operation, 'query', 'unusable query results must not trigger task reads or export');
        assert.equal(args.start, months[0].start);
        assert.equal(args.end, months[0].end);
        queries++;
        if (outcome === 'timeout') throw new Error('query timed out');
        if (outcome === 'stop-after-query') { stopped = true; return {status:'ready',count:1,merchantNo:'MERCHANT1'}; }
        return {status:outcome,reason:'query failed'};
      }
    }), outcome === 'stop-after-query' ? /STOPPED_BY_USER/ : /查询/);
    assert.equal(queries, 1);
    if (outcome !== 'stop-after-query') assert(failedEvents.some(event => event.status === 'FAILED'));
  }
  {
    let submits = 0, snapshots = 0;
    const events = [];
    const invoke = async operation => {
      if (operation === 'query') return {status:'ready',count:1,merchantNo:'89813015722APT1',merchantId:'merchant-id'};
      if (operation === 'submitExport') { submits++; return {status:'accepted'}; }
      if (operation === 'snapshotExportTasks') {
        snapshots++;
        if (snapshots === 1) return {status:'found',rows:[]};
        if (snapshots === 2) return {status:'loading'};
        if (snapshots === 3) throw new Error('暂存读取短暂失败');
        if (snapshots === 4) return {status:'found',rows:[]};
        return {status:'found',rows:[{id:'new-task',fileName:'MER_89813015722APT1_20261003113358_yjhx.xlsx'}]};
      }
      throw new Error(operation);
    };
    const promise = context.CHINAUMS_MONTHLY_RUNNER.run({months:[months[0]],gate:{},invoke,
      checkpoint:async()=>{},sleep:async()=>{},transition:async event=>events.push({...event})});
    const result = await promise;
    assert.equal(result[0].remoteTaskId, 'new-task');
    assert.equal(snapshots, 5, 'task binding tolerates loading, temporary errors and delayed tasks');
    assert.equal(submits, 1, 'accepted export must never be resubmitted');
  }
  console.log('PASS: monthly trade export binds each new server task before starting the next month');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
