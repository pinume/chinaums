const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function check(trade, mode) {
  let now = 1000, calls = 0, timer, cleared = false, signal;
  class Clock extends Date { static now() { return now; } }
  class Element {
    getClientRects() { return [1]; }
    closest() { return null; }
  }
  const request = async config => {
    calls++;
    signal = config.signal;
    assert.ok(signal, 'network request must receive a cancellation signal');
    if (mode === 'abort') {
      const pending = new Promise((resolve,reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), {once:true}));
      timer();
      return pending;
    }
    now = 4000; // First page arrives after the shared deadline.
    return trade ? {success:true,data:{list:[{id:'1',exportFileName:'one.xlsx'}],pages:2,total:2}}
      : {ok:true,json:async()=>({respCode:'000000',list:{content:[{export_id:'1',file_name:'one.xlsx'}],totalPages:2,totalElements:2}})};
  };
  const context = vm.createContext({Date:Clock,Element,AbortController,
    location:{protocol:'https:',hostname:'service.chinaums.com',pathname:trade?'/uisportalfront':'/uisportal/accountCheckDetailQry/toDetail',hash:'#/auditOfTrade2026'},
    localStorage:{getItem:()=>"TEST_TOKEN",setItem:()=>{}},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),
    fetch:async(url,config)=>{ if(url.endsWith("/init"))return {ok:true,json:async()=>({success:true,code:"000000",data:"TEST_TOKEN"})}; const data = await request(config); return trade ? {ok:true,json:async()=>data} : data; },
    setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{cleared=true;}
  });
  const file = trade?'trade-audit.js':'account-detail.js';
  vm.runInContext(fs.readFileSync(__dirname+'/'+file,'utf8'),context);
  const adapter = context[trade?'__chinaumsTradeAuditAdapter':'__chinaumsAccountDetailAdapter'];
  await assert.rejects(adapter('snapshotExportTasks',{operationDeadline:3000}), mode==='abort'?/aborted/:/截止时间/);
  assert.equal(calls,1,'expired read must not request the next page');
  assert.equal(signal.aborted,true);
  assert.equal(cleared,true);
}
(async()=>{
  for (const trade of [false,true]) for (const mode of ['late','abort']) await check(trade,mode);
  console.log('PASS: shared snapshot deadline aborts requests and prevents late pagination for both reports');
})().catch(error=>{console.error(error);process.exitCode=1;});
