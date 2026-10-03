const assert = require('node:assert/strict');
require('./download-runner.js');
const originalNow = Date.now;
let now = new Date(2026, 9, 3, 18).getTime();
Date.now = () => now;
const names = [1, 2, 3].map(n => `MER_89813014812B06R_2026100318000${n}_yjhx.xlsx`);
async function run({failure = false, transientOpen = false, unavailableHint = false} = {}) {
  let opens = 0, page = 1, opened = false, nextCalls = 0, openFailures = 0, hintFailures = 0;
  const clicks = [], events = [];
  const row = (index, ready) => ({fileName:names[index],createdAt:`2026-10-03 18:00:0${index+1}`,
    statusCode:ready?'ready':'pending',downloadEnabled:ready});
  const promise = CHINAUMS_DOWNLOAD_RUNNER.run({
    reportType:'trade-audit',merchantNo:'89813014812B06R',gate:{allowed:true,merchantNo:'89813014812B06R'},
    startedAt:new Date(now).toISOString(),
    submittedMonths:names.map((fileName,index)=>({month:`2026-0${index+1}`,remoteFileName:fileName,submittedAt:`2026-10-03T10:00:0${index+1}Z`})),
    checkpoint:async()=>{},sleep:async ms=>{now+=ms;},transition:async e=>events.push(e),
    invoke:async(op,args)=>{
      if(op==='openDownloadList') {
        if(transientOpen && opens===1 && openFailures++===0)return {status:'controls_missing'};
        opens++;opened=true;page=1;return {status:'clicked'};
      }
      if(op==='closeDownloadList'){opened=false;return {status:'already_closed'};}
      if(op==='parseDownloadTasks') {
        if(!opened)return {status:'not_open'};
        if(failure && opens>1)return {status:'refresh_error'};
        return {status:'found',page,total:opens===1?3:4,hasNext:page===1,
          rows:page===1?[row(0,true),...(opens>1?[row(1,true)]:[])]:[row(2,opens>=3)]};
      }
      if(op==='nextDownloadPage'){nextCalls++;page++;return {status:'clicked'};}
      if(op==='selectDownloadPage'){
        if(unavailableHint && opens>=3 && args.page===2 && hintFailures++===0)return {status:'unavailable'};
        page=args.page;return {status:'clicked'};
      }
      if(op==='downloadTask'){
        assert(!clicks.includes(args.fileName));
        if(args.fileName===names[0])assert.equal(opens,1,'ready month must download before missing task appears');
        clicks.push(args.fileName);return {status:'download_requested'};
      }
      if(op==='confirmDownload')return {status:'download_completed',downloadId:clicks.length};
      throw Error(op);
    }
  });
  if(failure){await assert.rejects(promise,/连续 3 次刷新读取失败/);assert.deepEqual(clicks,[names[0]]);}
  else {
    const result=await promise;
    assert.deepEqual(clicks,names);
    assert.equal(result.length,3,'return every completed month, including earlier downloads');
    assert.equal(nextCalls,unavailableHint?3:2,'invalid page hint falls back to full scan');
    if(transientOpen)assert.equal(openFailures,2);
  }
}
(async()=>{await run();await run({failure:true});await run({transientOpen:true});await run({unavailableHint:true});
  console.log('PASS: partial ready downloads, remaining-page scan, changed total, bounded refresh failures and transient reopen');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{Date.now=originalNow;});
