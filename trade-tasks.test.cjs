const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(text = '', classes = []) {this.textContent = text;this.innerText = text;this.classList = {contains: name => classes.includes(name)};this.children = [];}
  getClientRects() {return [1];}
  querySelectorAll() {return [];}
  querySelector(s) {return this.querySelectorAll(s)[0] || null;}
  getAttribute() {return null;}
  closest() {return null;}
}
let clicked = 0, ready = false, hidden = false, opening = 0;
let now = new Date(2026,8,30,18,13,40).getTime();
const steps = [];
const clock = class extends Date { static now() { return now; } };
const fileName = 'MER_89813014812B1L3_20260930181340_yjhx.xlsx';
const control = new Element('下载'); control.click = () => clicked++;
control.classList = {contains: name => !ready && name === 'is-disabled'};
const row = new Element();
row.children = ['2026-09-30 18:13:40', fileName, '', '下载'].map(text => {
  const cell = new Element(text);cell.tagName = 'TD'; cell.querySelectorAll = s => s === '.cell' ? [new Element(text || (ready ? '处理成功' : '待处理'))] : s === 'a,button,[role="button"]' ? [control] : [];return cell;
});
row.querySelectorAll = s => s === 'td' ? row.children : [];
const body = new Element(); body.querySelectorAll = s => s === 'tbody > tr' ? [row] : [];
const table = new Element();table.querySelectorAll = s => s.includes('thead th') ? ['创建时间','文件名','下载状态','操作'].map(t => new Element(t)) : s === '.el-table__body-wrapper' ? [body] : [];
const dialog = new Element('共 146 条'); dialog.querySelectorAll = s => s === '.el-dialog__title' ? [new Element('下载暂存列表')] : s === '.el-table' ? [table] : s === '.el-pagination .number.active' ? [new Element('1')] : s === '.el-table__body-wrapper tbody > tr' ? [row] : [];
const wrapper = new Element(); dialog.parentElement = wrapper;
const input = new Element(); input.value = '2026/09/01 ~ 2026/09/30';
const query = new Element('查询'); query.click = () => { assert(hidden); steps.push('query'); ready = true; };
const launch = new Element('下载暂存列表'); launch.click = () => { steps.push('open'); hidden = false; opening = 2; };
let closeClicks = 0;
const close = new Element('×'); close.click = () => { steps.push('close'); closeClicks++; if(closeClicks > 1) hidden = true; };
const oldDialogQuery = dialog.querySelectorAll;
dialog.querySelectorAll = selector => selector === '.el-dialog__headerbtn' ? [close] : oldDialogQuery(selector);

const context = vm.createContext({Element, Date:clock, getComputedStyle: element => ({display:'block',visibility:'visible',opacity:element === wrapper && hidden ? '0' : '1'}), location:{hostname:'service.chinaums.com',pathname:'/uisportalfront/',hash:'#/auditOfTrade2026'},document:{body:new Element('根据查询条件共查询到 1 条记录'),querySelectorAll:s => {
  if (s === '.el-dialog') { if (opening > 0) { opening--; return []; } return [dialog]; }
  if (s === 'input.deal-date') return [input];
  if (s === 'button') return [query, launch, new Element('批量导出')];
  if (s === '.el-table__body-wrapper tbody > tr') return [row];
  return [];
}}});
vm.runInContext(fs.readFileSync(__dirname+'/trade-audit.js','utf8'), context);
(async () => {
  const adapter = context.__chinaumsTradeAuditAdapter;
  let parsed = await adapter('parseDownloadTasks'); assert.equal(parsed.status,'found'); assert.equal(parsed.rows[0].statusCode,'pending'); assert.equal(parsed.rows[0].downloadEnabled,false);
  const args = {fileName, targetMerchantNo:'89813014812B1L3', gate:{allowed:true,merchantNo:'89813014812B1L3'}};
  assert.equal((await adapter('downloadTask',args)).status,'not_ready');
  ready = true;parsed = await adapter('parseDownloadTasks');assert.equal(parsed.rows[0].statusCode,'ready');assert.equal(parsed.rows[0].downloadEnabled,true);
  assert.equal((await adapter('downloadTask',args)).status,'download_requested');assert.equal(clicked,1);
  assert.equal((await adapter('downloadTask',{...args,fileName:fileName.replace('B1L3','B06R')})).status,'blocked');assert.equal(clicked,1);
  hidden = true; assert.equal((await adapter('parseDownloadTasks')).status,'not_open');
  vm.runInContext(fs.readFileSync(__dirname+'/download-runner.js','utf8'), context);
  ready = false; clicked = 0;
  await context.CHINAUMS_DOWNLOAD_RUNNER.run({
    reportType:'trade-audit',merchantNo:args.targetMerchantNo,gate:args.gate,
    startedAt:new Date(2026,8,30,18,13,0).toISOString(),
    submittedMonths:[{month:'2026-09',submittedAt:new Date(2026,8,30,18,13,0).toISOString()}],
    checkpoint:async()=>{}, sleep:async ms=>{now+=ms;},transition:async()=>{},
    invoke:async(op, params)=>{
      if(op==='downloadTask') { steps.push('download'); assert(ready); }
      if(op==='confirmDownload') { steps.push('complete'); return {status:'download_completed',downloadId:1}; }
      return adapter(op,params);
    }
  });
  assert.deepEqual(steps,['open','close','close','query','open','download','complete','close']);
  assert.equal(clicked,1); assert(hidden);
  console.log('PASS: actual Element table layout, pending/disabled, successful downloads and foreign merchant rejection');
})().catch(e => {console.error(e);process.exitCode = 1;});
