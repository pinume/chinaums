const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(`${__dirname}/export-runner.js`, "utf8");
let response = {status:"ready"}, downloads = 0, downloadResult = 73;
const fileName = "MERCHANT1_MX_20261005120000.xlsx";
const taskId = "a".repeat(32);
const context = vm.createContext({
  Date, URL, tabId:7, SITE_CONFIG:{host:"service.chinaums.com"},
  checkpoint:async()=>{}, withTimeout:promise=>promise,
  chrome:{
    scripting:{executeScript:async({target,world,files,args})=>{
      assert.equal(target.tabId,7);
      assert.deepEqual(Array.from(target.frameIds),[0]);
      assert.equal(world,"ISOLATED");
      if(files)return [];
      return [{result:args.length===1?true:response}];
    }},
    downloads:{download:async options=>{
      downloads++;
      assert.equal(options.conflictAction,"uniquify");
      assert.equal(options.url,`https://service.chinaums.com/uisportal/commonController/exportDeailBill?exportId=${taskId}`);
      return downloadResult;
    }}
  }
});
vm.runInContext(source.slice(source.indexOf("const injectedAdapters ="), source.indexOf("const parsePortalTimestamp ="))+"globalThis.invokeApi=invoke;",context);
(async()=>{
  for(const report of ["account-detail","trade-audit"]) assert.equal((await context.invokeApi(report,"query")).status,"ready");
  const args={fileName,taskId};
  response={status:"download_requested",url:`https://service.chinaums.com/uisportal/commonController/exportDeailBill?exportId=${taskId}`};
  const result=await context.invokeApi("account-detail","downloadTaskDirect",args);
  assert.equal(result.downloadId,73);
  assert.equal(result.url,undefined,"credential URL must not reach persisted state");
  for(const url of ["https://other.example/file",`https://service.chinaums.com/uisportal/commonController/exportDeailBill?exportId=wrong`]){
    response={status:"download_requested",url};
    await assert.rejects(context.invokeApi("account-detail","downloadTaskDirect",args),/下载地址/);
  }
  assert.equal(downloads,1);
  response={status:"download_requested",url:`https://service.chinaums.com/uisportal/commonController/exportDeailBill?exportId=${taskId}`};
  downloadResult=undefined;
  await assert.rejects(context.invokeApi("account-detail","downloadTaskDirect",args),/有效下载 ID/);
  assert.equal(downloads,2,"Chrome ID failure must not cause another download request");
  console.log("PASS: both reports use isolated top frame and download transport returns exact Chrome ID without navigation or iframe detection");
})().catch(error=>{console.error(error);process.exitCode=1;});
