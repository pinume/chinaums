const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function check(trade, mode) {
  let now = 1000, calls = 0, timer, signal;
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({
    Date: Clock, URLSearchParams, AbortController,
    location: {protocol:'https:',hostname:'service.chinaums.com',pathname:'/uisportal/home'},
    localStorage: {getItem:()=>mode==='missing-token'?'':'TEST_TOKEN',setItem:()=>{}},
    setTimeout: fn => { timer = fn; return 1; }, clearTimeout:()=>{},
    fetch: async (url, options) => {
      if(url.endsWith("/init")) return {ok:true,json:async()=>({success:mode!=="missing-token",code:"000000",data:"TEST_TOKEN"})};
      calls++;
      signal = options.signal;
      return {ok:true,status:200,redirected:mode==='redirect',json:async()=>{
        if(mode==='body-timeout') {
          timer();
          throw new Error('body aborted');
        }
        now = 4000;
        return trade ? {success:true,code:'000000',data:{list:[],total:0,pages:0,size:10,current:0}}
          : {respCode:'000000',pageObj:{content:[],totalElements:0,totalPages:0,size:100,number:0}};
      }};
    }
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/${trade?'trade-audit':'account-detail'}.js`,'utf8'),context);
  const adapter = context[trade?'__chinaumsTradeAuditAdapter':'__chinaumsAccountDetailAdapter'];
  const result = await adapter('query',{start:'2026-01-01',end:'2026-01-31',operationDeadline:3000});
  assert.equal(result.status,'failed',`${mode} must not yield a usable query`);
  if(mode==='missing-token') assert.equal(calls,0);
  if(mode==='body-timeout') assert.equal(signal.aborted,true);
  if(mode==='redirect') assert.equal(calls,1);
  assert.equal((await adapter('submitExport',{gate:{allowed:true},targetMerchantNo:'MERCHANT1'})).status,'blocked');
}
(async()=>{
  for(const trade of [false,true]) for(const mode of ['redirect','body-timeout','late']) await check(trade,mode);
  await check(true,'missing-token');
  console.log('PASS: API-only requests reject login redirects, abort stalled bodies, reject late results, and block export without valid query');
})().catch(error=>{console.error(error);process.exitCode=1;});
