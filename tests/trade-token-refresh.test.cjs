const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
async function check(mode) {
  let token=null, inits=0, queries=0, submits=0;
  const context=vm.createContext({Date,AbortController,AbortSignal,setTimeout,clearTimeout,
    location:{protocol:'https:',hostname:'service.chinaums.com',pathname:'/uisportal/home'},
    localStorage:{getItem:()=>token,setItem:(key,value)=>{assert.equal(key,'userPortalVerifyToken');token=value;}},
    fetch:async(url,options)=>{
      let data;
      if(url.endsWith('/init')) {
        inits++;
        data=mode==='init-failed'?{success:false,code:'999998'}:{success:true,code:'000000',data:`TEST_TOKEN_${inits}`};
      } else {
        assert.equal(options.headers.userPortalToken,token);
        if(url.endsWith('/queryList')) {
          queries++;
          data=(mode==='expired'&&queries===1)||mode==='still-expired'
            ? {success:false,code:'999998',message:'回话失效'}
            : {success:true,code:'000000',data:{size:500,current:0,total:1,pages:1,list:[{id:'row1',mchntId:'merchant-id',transDate:'20260101'}]}};
        } else if(url.endsWith('/applyExport')) {
          submits++;
          data={success:false,code:'999998',message:'回话失效'};
        } else throw Error(url);
      }
      return {ok:true,status:200,json:async()=>data};
    }
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/../trade-audit.js`,'utf8'),context);
  const adapter=context.__chinaumsTradeAuditAdapter;
  const state=await adapter('query',{start:'2026-01-01',end:'2026-01-31',operationDeadline:Date.now()+30000});
  if(mode==='init-failed') {assert.equal(state.status,'failed');assert.equal(queries,0);return;}
  if(mode==='still-expired') {assert.equal(state.status,'failed');assert.match(state.reason,/会话失效/);assert.equal(inits,2);assert.equal(queries,2);return;}
  assert.equal(state.status,'ready');
  assert.equal(inits,mode==='expired'?2:1);
  assert.equal(queries,mode==='expired'?2:1);
  if(mode==='submit-expired') {
    const result=await adapter('submitExport',{operationDeadline:Date.now()+30000,targetMerchantId:'merchant-id',
      gate:{allowed:true,merchantId:'merchant-id',authentication:{status:'logged_in',confidence:'high'}}});
    assert.equal(result.status,'unknown');
    assert.match(result.reason,/会话失效/);
    assert.equal(submits,1,'an export request must never be automatically repeated');
    assert.equal(inits,1,'export response does not trigger a refresh and replay');
  }
}
(async()=>{
  for(const mode of ['initial','expired','still-expired','init-failed','submit-expired'])await check(mode);
  console.log('PASS: native token initialization, one refresh for expired reads, bounded failures and no export replay');
})().catch(error=>{console.error(error);process.exitCode=1;});
