const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let calls = 0;

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
const respond = async () => {
    calls++;
    return {success:true, data:{size:100,current:0,total:241,pages:25,list:rows}};
};

const context = vm.createContext({
  fetch: async (url, options) => {
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.headers["Content-Type"], "application/json");
    if (url === "/uisportal/api/userPortalVerify/init") return {ok:true,json:async()=>({
      success: true, code:"000000", data:"TEST_TOKEN"
    })};
    assert.equal(options.headers.userPortalToken, "TEST_TOKEN");
    const data = await respond(JSON.parse(options.body), url.replace("/uisportal/api/", ""), options);
    return { ok: true, status: 200, json: async () => data };
  },
  AbortController, Date,
  location:{protocol:'https:',hostname:'service.chinaums.com',pathname:'/uisportalfront/',hash:'#/auditOfTrade2026'},
  localStorage:{getItem:()=>"TEST_TOKEN",setItem:()=>{}},
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
