const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = vm.createContext({
  location: { protocol: "https:", hostname: "service.chinaums.com", pathname: "/uisportal/home" },
  Date, AbortController, setTimeout, clearTimeout,
  fetch: async () => ({ok:true,json:async()=>({respCode:"000000",list:{totalPages:1,totalElements:2,content:[
    {export_id:"one",file_name:"one.xlsx",task_status:"10"},{export_id:"two",file_name:"two.xlsx",task_status:"30"}
  ]}})})
});
vm.runInContext(fs.readFileSync(`${__dirname}/../account-detail.js`, "utf8"), context);
(async () => {
  for (const operation of ["inspect", "submitDialogState", "classifySubmit", "closeSubmitDialog", "closeDownloadList", "openDownloadList", "parseDownloadTasks", "downloadTask"]) {
    assert.equal((await context.__chinaumsAccountDetailAdapter(operation)).status, "unknown_operation");
  }
  const snapshot = await context.__chinaumsAccountDetailAdapter("snapshotExportTasks");
  assert.deepEqual(Array.from(snapshot.rows, row => row.statusCode), ["pending", "ready"]);

  console.log("PASS: account-detail.js needs no business page DOM and has no dialog/list operations");
})().catch(error => { console.error(error); process.exitCode = 1; });
