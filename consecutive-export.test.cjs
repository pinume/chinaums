const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let now = new Date(2026, 8, 30, 12).getTime();
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const context = vm.createContext({Date: Clock});
vm.runInContext(fs.readFileSync(`${__dirname}/monthly-runner.js`, 'utf8'), context);
const merchant = 'MERCHANT1';
const months = [1, 2].map(n => ({key: `2026-0${n}`, start: `2026-0${n}-01`, end: `2026-0${n}-28`}));
async function check(mode, trade = false) {
  const tasks = [{id: 'old', fileName: 'old.xlsx'}];
  let submits = 0, accepted = 0, throttles = 0, current, delayed = false;
  const events = [];
  const result = context.CHINAUMS_MONTHLY_RUNNER.run({months, gate: {},
    checkpoint: async () => {}, sleep: async ms => {now += ms;},
    transition: async e => {events.push({...e}); if(e.month) current = e.month;},
    invoke: async (operation, args) => {
      if(operation === 'setDateRange') return {status:'set'};
      if(operation === 'query') return {status:'clicked'};
      if(operation === 'queryState') return {status:'ready',count:1,
        ...(trade ? {merchantId: mode === 'switch-id' && accepted ? 'changed-id' : 'internal-id'} : {merchantNo:merchant})};
      if(operation === 'snapshotExportTasks') {
        if(mode === 'baseline-error' && !submits) throw new Error('baseline unavailable');
        if(delayed) { delayed = false; return {status:'found',rows:tasks.slice(0,-1)}; }
        return {status:'found',rows:[...tasks]};
      }
      if(operation === 'submitExport') {
        submits++;
        if(trade) assert.equal(args.targetMerchantId,'internal-id');
        return {status:'clicked'};
      }
      if(operation === 'classifySubmit') {
        if(mode === 'throttle' && throttles++ < 3) return {status:'throttled'};
        accepted++;
        const stamp = '2026093012000' + accepted; // Both tasks fall inside the old ±2-second window.
        tasks.push({id:current,fileName:trade ? `MER_${merchant}_${stamp}_yjhx.xlsx` : `${merchant}_MX_${stamp}.xlsx`});
        if(mode === 'ambiguous') tasks.push({id:'concurrent',fileName:`${merchant}_MX_20260930120009.xlsx`});
        delayed = mode === 'delayed';
        return {status:'accepted'};
      }
      if(operation === 'closeSubmitDialog') return {status:'closed'};
      throw new Error(operation);
    }
  });
  if(['ambiguous','baseline-error','switch-id'].includes(mode)) {
    await assert.rejects(result);
    assert.equal(submits,mode === 'baseline-error' ? 0 : 1, 'uncertain accepted tasks must never be resubmitted');
    if(mode === 'ambiguous') assert(events.some(e=>e.status==='SUBMITTED'));
  } else {
    const rows = await result;
    assert.equal(rows.length,2);
    assert.equal(new Set(rows.map(r=>r.remoteFileName)).size,2);
    assert.deepEqual(Array.from(rows,r=>r.remoteTaskId),months.map(m=>m.key));
    if(mode==='throttle') {assert.equal(submits,5);assert.equal(events.filter(e=>e.status==='WAITING_FOR_SLOT').length,3);assert(events.filter(e=>e.status==='WAITING_FOR_SLOT').every(e=>e.month==='2026-01'));assert.equal(events.filter(e=>e.status==='SETTING_DATE').length,2);}
  }
}
(async()=>{
  for(const trade of [false,true]) for(const mode of ['normal','delayed','throttle','ambiguous','baseline-error']) await check(mode,trade);
  await check('switch-id',true);
  // Numeric limits differ between server deployments; keep the same dialog semantics.
  for(const [file, name, text] of [['account-detail.js','__chinaumsAccountDetailAdapter','您已有超过 4 条未处理或处理中的导出文件，请稍后再试'],['trade-audit.js','__chinaumsTradeAuditAdapter','超过 10 条申请在处理中']]) {
    class Element {getClientRects(){return [1];} get innerText(){return text;}}
    const dialog = new Element();
    const c=vm.createContext({Element,location:{hostname:'service.chinaums.com',pathname:file.startsWith('trade')?'/uisportalfront/':'/uisportal/accountCheckDetailQry/toDetail',hash:'#/auditOfTrade2026'},
      getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}), document:{body:dialog,querySelectorAll:()=>[dialog]}});
    vm.runInContext(fs.readFileSync(`${__dirname}/${file}`,'utf8'),c);
    assert.equal((await c[name]('classifySubmit')).status,'throttled');
  }
  console.log('PASS: consecutive task IDs, overlapping timestamps, delayed listing, throttling, merchant ID changes and numeric limit dialogs');
})().catch(e=>{console.error(e);process.exitCode=1;});
