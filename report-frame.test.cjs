const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/export-runner.js', 'utf8');
const context = vm.createContext({
  SITE_CONFIG: {frontendRoot:'/uisportalfront',reportRoutes:{accountDetail:'/uisportal/accountCheckDetailQry/toDetail'}},
  tabId:7,location:{pathname:'/uisportalfront/',hash:'#/auditOfTrade2026'},window:{top:{}},
  chrome:{scripting:{executeScript:async({func,args})=>[{frameId:114,result:func(args[0])}]}}
});
vm.runInContext(source.slice(source.indexOf('const currentFrameId ='),source.indexOf('const waitForDownload =')) + '\nglobalThis.findFrame = currentFrameId;',context);
(async()=>{
  assert.equal(await context.findFrame('trade-audit'),114);
  context.location.pathname='/uisportalfront';assert.equal(await context.findFrame('trade-audit'),114);
  context.location.hash='#/auditOfTrade2025';assert.equal(await context.findFrame('trade-audit'),null);
  context.location.hash='#/auditOfTrade2026';context.location.pathname='/other';assert.equal(await context.findFrame('trade-audit'),null);
  context.location.pathname='/uisportal/accountCheckDetailQry/toDetail';context.window.top=context.window;
  assert.equal(await context.findFrame('account-detail'),114);
  console.log('PASS: actual business iframe URL with trailing slash, nonmatching routes and detail frame');
})().catch(e=>{console.error(e);process.exitCode=1;});
