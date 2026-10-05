const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function check(trade, stuck) {
  let wall = new Date(2026,9,3).getTime();
  class Clock extends Date { constructor(...a) { super(...(a.length?a:[wall])); } static now() { return wall; } }
  const c = vm.createContext({Date:Clock});
  const source = fs.readFileSync(`${__dirname}/export-runner.js`,'utf8');
  vm.runInContext(source.slice(source.indexOf('let pausedAt ='),source.indexOf('const statusLabels ='))+'\nglobalThis.now = activeNow;',c);
  for (const name of ['monthly-runner.js','download-runner.js']) vm.runInContext(fs.readFileSync(`${__dirname}/${name}`,'utf8'),c);
  const pause = () => {
    const before = c.now();
    vm.runInContext('pausedAt = Date.now();',c);
    wall += 300000;
    assert.equal(c.now(),before);
    vm.runInContext('finishPause();',c);
    assert.equal(c.now(),before);
  };
  const file = trade?'MER_MERCHANT1_20261003000001_yjhx.xlsx':'MERCHANT1_MX_20261003000001.xlsx';
  const events = []; let phase = "INITIAL", pausedPhase, tasks = [], submitted = 0;
  await c.CHINAUMS_MONTHLY_RUNNER.run({reportType:trade?'trade-audit':'account-detail',
    months:[{key:'2026-01',start:'2026-01-01',end:'2026-01-31'}],gate:{},now:c.now,
    sleep:async ms=>{wall+=ms;},checkpoint:async()=>{if(phase!==pausedPhase){pausedPhase=phase;pause();}},
    transition:async e=>{events.push(e);phase=e.status;},invoke:async(op,args)=>{
      if(op==='submitDialogState')return {status:'clear'};
      if(op==='query')return {status:'ready',count:1,...(trade?{merchantId:'id'}:{merchantNo:'MERCHANT1'})};
      if(op==='snapshotExportTasks'){
        if(args.operationDeadline)assert(args.operationDeadline>wall,'adapter receives a wall-clock deadline even after pauses');
        return {status:'found',rows:tasks};
      }
      if(op==='submitExport'){
        submitted++;
        tasks=[{id:'1',fileName:file}];
        return {status:'accepted'};
      }
      if(op==='closeSubmitDialog')return {status:'closed'};
      throw Error(op);
    }});
  assert.equal(submitted,1);
  let downloads = 0, downloadPaused = false;
  const calls = [];
  const promise = c.CHINAUMS_DOWNLOAD_RUNNER.run({reportType:trade?'trade-audit':'account-detail',merchantNo:'MERCHANT1',
    gate:{allowed:true,merchantNo:'MERCHANT1'},startedAt:new Clock().toISOString(),
    submittedMonths:[{month:'2026-01',remoteFileName:file,remoteTaskId:'task-1',submittedAt:new Clock().toISOString()}],now:c.now,
    sleep:async ms=>{wall+=ms;},checkpoint:async()=>{if(!downloadPaused){downloadPaused=true;pause();}},transition:async()=>{},
    invoke:async (op,args)=>{
      calls.push(op);
      if(op==='snapshotExportTasks'){
        return {status:'found',rows:[{id:'task-1',fileName:file,statusCode:'ready',
          ...(trade?{exportStatus:'02',exportStatusDesc:'成功'}:{taskStatus:'30'})}]};
      }
      if(op==='downloadTaskDirect'){
        assert.equal(args.fileName,file);
        downloads++;
        return {status:'download_requested',downloadId:1};
      }
      if(op==='confirmDownload')return stuck?{status:'download_unknown'}:{status:'download_completed',downloadId:1};
      throw Error(op);
    }});
  if(stuck)await assert.rejects(promise,/下载完成状态无法确认/);
  else await promise;
  for(const operation of ['openDownloadList','parseDownloadTasks','downloadTask','closeDownloadList']) {
    assert(!calls.includes(operation), 'direct download must not use list UI');
  }
  assert.equal(downloads,1);
}
(async()=>{
  for(const trade of [false,true])for(const stuck of [false,true])await check(trade,stuck);
  console.log('PASS: pauses preserve deadlines; both reports download directly and stop when Chrome completion is unknown');
})().catch(e=>{console.error(e);process.exitCode=1;});
