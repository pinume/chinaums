const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
async function check(mode) {
  let now = new Date(2026,9,3).getTime();
  class Clock extends Date { constructor(...a){super(...(a.length?a:[now]));} static now(){return now;} }
  const c=vm.createContext({Date:Clock});
  vm.runInContext(fs.readFileSync(`${__dirname}/monthly-runner.js`,'utf8'),c);
  const merchant='89813015722APT1',tasks=[],events=[];
  let month,submits=0,throttled=false,opened=false,polls=0,waitStart;
  await c.CHINAUMS_MONTHLY_RUNNER.run({
    months:[1,2].map(m=>({key:`2026-0${m}`,start:`2026-0${m}-01`,end:`2026-0${m}-28`})),reportType:'account-detail',gate:{},
    checkpoint:async()=>{},sleep:async ms=>{now+=ms;},transition:async e=>{events.push(e);if(e.month)month=e.month;if(e.status==='WAITING_FOR_SLOT'&&waitStart===undefined)waitStart=now;},
    invoke:async op=>{
      if(op==='submitDialogState')return {status:'clear'};
      if(op==='setDateRange')return {status:'set'};
      if(op==='query')return {status:'clicked'};
      if(op==='queryState')return {status:'ready',count:1,merchantNo:merchant};
      if(op==='snapshotExportTasks')return {status:'found',rows:[...tasks]};
      if(op==='submitExport'){
        assert(!opened);
        submits++;
        if(month==='2026-02'&&!throttled){throttled=true;return {status:'throttled',source:'api'};}
        tasks.push({id:month,fileName:`${merchant}_MX_2026100300000${tasks.length+1}.xlsx`});
        return {status:'accepted',source:'api'};
      }
      if(op==='classifySubmit')throw Error('direct account submit must not wait for UI classification');
      if(op==='closeSubmitDialog')return {status:'closed'};
      if(op==='openDownloadList'){opened=true;return {status:'clicked'};}
      if(op==='setDownloadPageSize')return {status:'unchanged'};
      if(op==='closeDownloadList'){if(mode==='close-failure')return {status:'blocked'};opened=false;return {status:'closed'};}
      if(op==='parseDownloadTasks'){
        if(!opened)return {status:'not_found'};
        polls++;
        if(mode==='read-failure')throw Error('temporary read failure');
        return {status:'found',rows:[{fileName:tasks[0].fileName,statusCode:polls>1?'ready':'pending'}]};
      }
      throw Error(op);
    }
  });
  assert.equal(submits,3,'accepted first month must not be resubmitted');
  assert.equal(tasks.length,2);
  assert(!opened);
  if(mode==='read-failure')assert(now-waitStart>=30000,'read failure keeps original backoff');
  else {assert(now-waitStart<30000,'generation completion releases wait early');assert(events.some(e=>e.pending===0));}
}
(async()=>{await check('normal');await check('read-failure');await assert.rejects(check('close-failure'),/暂存列表无法关闭/);console.log('PASS: account slot progress, early retry, read failure fallback, close failure and no resubmission');})().catch(e=>{console.error(e);process.exitCode=1;});
