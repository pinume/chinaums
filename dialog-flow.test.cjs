const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
async function check(stuck){
  let now=new Date(2026,9,3).getTime(),closedAt=null,submits=0,dates=0;
  class Clock extends Date {constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
  const c=vm.createContext({Date:Clock});vm.runInContext(fs.readFileSync(`${__dirname}/monthly-runner.js`,'utf8'),c);
  const tasks=[],events=[];
  const run=c.CHINAUMS_MONTHLY_RUNNER.run({reportType:'trade-audit',months:[1,2].map(m=>({key:`2026-0${m}`,start:`2026-0${m}-01`,end:`2026-0${m}-28`})),gate:{},checkpoint:async()=>{},sleep:async ms=>{now+=ms;},transition:async e=>events.push(e),
    invoke:async op=>{
      if(op==='submitDialogState'){
        if(closedAt===null)return {status:'clear'};
        const elapsed=now-closedAt;
        return {status:stuck||elapsed<700||(elapsed>=1200&&elapsed<1450)?'visible':'clear'};
      }
      if(op==='query'){dates++;return {status:'ready',count:1,merchantNo:'MERCHANT1',merchantId:'internal-id'};}
      if(op==='snapshotExportTasks')return {status:'found',rows:[...tasks]};
      if(op==='submitExport'){
        submits++;
        tasks.push({id:String(submits),fileName:`MER_MERCHANT1_2026100300000${submits}_yjhx.xlsx`});
        return {status:'accepted'};
      }
      if(op==='closeSubmitDialog'){closedAt=now;return {status:'closed'};}
      throw Error(op);
    }});
  await run;assert.equal(submits,2);assert.equal(dates,2);assert.equal(closedAt,null,'must never close website dialogs');
}
(async()=>{await check(false);await check(true);console.log('PASS: visible or stuck website dialogs do not participate in API monthly flow');})().catch(e=>{console.error(e);process.exitCode=1;});
