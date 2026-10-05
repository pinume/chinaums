const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let calls = 0;
class Element {
  getClientRects() { return [1]; }
  closest() { return null; }
}
const rows = [
  {id:'task-ready', exportFileName:'MER_89813014812B06R_20261005111420_yjhx.xlsx',
    exportFilePath:'/apps/data/yjhxexport2026', exportStatus:'02', exportStatusDesc:'成功',
    createTime:'2026-10-05 11:14:20', modifyTime:'2026-10-05 11:21:16', errorMsg:null},
  {id:'task-pending', exportFileName:'MER_89813014812B06R_20261005111410_yjhx.xlsx',
    exportFilePath:'/apps/data/yjhxexport2026', exportStatus:'01', exportStatusDesc:'处理中',
    createTime:'2026-10-05 11:14:10', modifyTime:'2026-10-05 11:14:10', errorMsg:null},
  {id:'task-failed', exportFileName:'MER_89813014812B06R_20261005110538_yjhx.xlsx',
    exportFilePath:'/apps/data/yjhxexport2026', exportStatus:'02', exportStatusDesc:'成功',
    createTime:'2026-10-05 11:05:38', modifyTime:'2026-10-05 11:11:16', errorMsg:'生成失败'}
];
const fetch = async (url, options) => {
  calls++;
  assert.ok(url.endsWith("/qryExportDtls"));
  assert.equal(options.headers.userPortalToken, "TEST_TOKEN");
  return { ok: true, status: 200, json: async () => ({
    success:true, data:{size:100,current:0,total:241,pages:25,list:rows}
  }) };
};
const context = vm.createContext({
  Element, AbortController, Date,
  location:{hostname:'service.chinaums.com',pathname:'/uisportalfront/',hash:'#/auditOfTrade2026'},
  localStorage:{getItem:()=> 'TEST_TOKEN'},
  getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),
  document:{querySelectorAll:()=>[]},
  fetch,
  setTimeout, clearTimeout
});
vm.runInContext(fs.readFileSync(__dirname + '/trade-audit.js','utf8'), context);

(async () => {
  const result = await context.__chinaumsTradeAuditAdapter('snapshotExportTasks', {
    taskIds:['task-ready','task-pending','task-failed']
  });
  assert.equal(result.status, 'found');
  assert.equal(calls, 1, 'once every requested task ID is found, historical pages must not be scanned');
  assert.deepEqual(Array.from(result.rows, row => row.statusCode), ['ready','pending','failed']);
  assert.equal(result.rows[0].exportStatus, '02');
  assert.equal(result.rows[0].exportStatusDesc, '成功');
  assert.equal(result.rows[0].createdAt, '2026-10-05 11:14:20');
  assert.equal(result.rows[2].errorMsg, '生成失败');
  console.log('PASS: trade snapshot maps real export status fields and stops pagination after all requested task IDs are found');
})().catch(error => { console.error(error); process.exitCode = 1; });
