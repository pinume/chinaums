const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({Date});
vm.runInContext(fs.readFileSync(__dirname + '/monthly-runner.js', 'utf8'), context);
const yearToDate = context.CHINAUMS_MONTHLY_RUNNER.yearToDateMonths;
const january = yearToDate(new Date(2026, 0, 1));
assert.equal(january.length, 1); assert.equal(january[0].end, '2026-01-01');
const leap = yearToDate(new Date(2024, 2, 15));
assert.equal(leap[1].end, '2024-02-29'); assert.equal(leap[2].end, '2024-03-15');
const december = yearToDate(new Date(2026, 11, 31));
assert.equal(december.length, 12); assert.equal(december[11].end, '2026-12-31');
const months = [{key: '2026-01', start: '2026-01-01', end: '2026-01-31'}, {key: '2026-02', start: '2026-02-01', end: '2026-02-28'}];
async function run() {
  const calls = [];
  await context.CHINAUMS_MONTHLY_RUNNER.run({
    months, gate:{authentication:{status:'logged_in',confidence:'high'}}, merchantFromTasks:true,
    checkpoint:async()=>{},sleep:async()=>{},transition:async()=>{},
    invoke:async operation=>{
      calls.push(operation);
      if(operation==='setDateRange')return{status:'set'};
      if(operation==='query'||operation==='submitExport')return{status:'clicked'};
      if(operation==='queryState')return{status:'ready',count:132};
      if(operation==='classifySubmit')return{status:'accepted'};
      if(operation==='closeSubmitDialog')return{status:'closed'};
      throw new Error(operation);
    }
  });
  assert.deepEqual(calls, Array(2).fill(['setDateRange','query','queryState','submitExport','classifySubmit','closeSubmitDialog']).flat());
  const emptyEvents = [];
  await context.CHINAUMS_MONTHLY_RUNNER.run({
    months, gate: {}, merchantFromTasks: true,
    checkpoint: async () => {}, sleep: async () => {}, transition: async event => emptyEvents.push(event),
    invoke: async operation => {
      if (operation === 'setDateRange') return {status:'set'};
      if (operation === 'query') return {status:'clicked'};
      if (operation === 'queryState') return {status:'no_data',count:0};
      throw new Error(`empty month must not export: ${operation}`);
    }
  });
  assert.equal(emptyEvents.filter(event => event.status === 'NO_DATA').length, months.length);
  console.log('PASS: monthly trade export closes success notice and immediately starts next month without opening task list');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
