const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(text = '', classes = []) {this.textContent = text;this.innerText = text;this.classList = {contains: name => classes.includes(name)};this.children = [];}
  getClientRects() {return [1];}
  querySelectorAll() {return [];}
  querySelector(s) {return this.querySelectorAll(s)[0] || null;}
  getAttribute() {return null;}
  closest(selector) {return selector === '.el-dialog__wrapper' ? this.wrapper || null : null;}
}
let failed = false;
let clicked = 0, ready = false, hidden = false, opening = 0, loading = false;
let now = new Date(2026,8,30,18,13,40).getTime();
let refreshAt = now;
let resourceAvailable = true, resourceStatus = 200;
let autoCloseComponent = null;
const steps = [];
const clock = class extends Date { static now() { return now; } };
const fileName = 'MER_89813014812B1L3_20260930181340_yjhx.xlsx';
let headerLabels = ['创建时间','文件名','下载状态','操作'];
const control = new Element('下载'); control.click = () => clicked++;
control.classList = {contains: name => !ready && name === 'is-disabled'};
const row = new Element();
row.children = ['2026-09-30 18:13:40', fileName, '', '下载'].map(text => {
  const cell = new Element(text);cell.tagName = 'TD'; cell.querySelectorAll = s => s === '.cell' ? [new Element(text || (failed ? '处理失败' : ready ? '处理成功' : '待处理'))] : s === 'a,button,[role="button"]' ? [control] : [];return cell;
});
row.querySelectorAll = s => s === 'td' ? row.children : [];
const body = new Element(); body.querySelectorAll = s => s === 'tbody > tr' ? [row] : [];
const table = new Element();table.querySelectorAll = s => s.includes('thead th') ? headerLabels.map(t => new Element(t)) : s === '.el-table__body-wrapper' ? [body] : [];
const dialog = new Element('共 146 条'); dialog.querySelectorAll = s => s === '.el-dialog__title' ? [new Element('下载暂存列表')] : s === '.el-table' ? [table] : s === '.el-pagination .number.active' ? [new Element('1')] : s === '.el-table__body-wrapper tbody > tr' ? [row] : [];
const wrapper = new Element(); dialog.parentElement = wrapper;
const input = new Element(); input.value = '2026/09/01 ~ 2026/09/30';
const query = new Element('查询'); query.click = () => { throw new Error('下载状态刷新不应重新查询交易'); };
const launch = new Element('下载暂存列表'); launch.click = () => { refreshAt = now; steps.push('open'); hidden = false; opening = 2; if(closeClicks > 1) ready = true; };
let closeClicks = 0;
const close = new Element('×'); close.click = () => { steps.push('close'); closeClicks++; if(closeClicks > 1) hidden = true; };
const oldDialogQuery = dialog.querySelectorAll;
dialog.querySelectorAll = selector => selector === '.el-dialog__headerbtn' ? [close] : oldDialogQuery(selector);

class Observer {
  constructor(callback) { this.callback = callback; }
  observe() {
    if (autoCloseComponent) Promise.resolve().then(() => {
      autoCloseComponent.visible = false;
      this.callback();
    });
  }
  disconnect() {}
}
const context = vm.createContext({Element, Date:clock, MutationObserver:Observer,
  setTimeout: fn => { Promise.resolve().then(fn); return 1; }, clearTimeout:()=>{},
  performance:{now:()=>now,getEntriesByType:()=>resourceAvailable ? [{name:"https://service.chinaums.com/qryExportDtls",startTime:refreshAt,responseEnd:refreshAt+1,responseStatus:resourceStatus}] : []}, getComputedStyle: element => ({display:'block',visibility:'visible',opacity:element === wrapper && hidden ? '0' : '1'}), location:{hostname:'service.chinaums.com',pathname:'/uisportalfront/',hash:'#/auditOfTrade2026'},document:{documentElement:{},body:new Element('根据查询条件共查询到 1 条记录'),querySelectorAll:s => {
  if (s === '.el-dialog') { if (opening > 0) { opening--; return []; } return [dialog]; }
  if (s === 'input.deal-date') return [input];
  if (s === 'button') return [query, launch, new Element('批量导出')];
  if (s === '.el-table__body-wrapper tbody > tr') return [row];
  if (s === '.el-loading-mask,.layui-layer-loading,.loading' && loading) return [new Element()];
  return [];
}}});
vm.runInContext(fs.readFileSync(__dirname+'/trade-audit.js','utf8'), context);
(async () => {
  const adapter = context.__chinaumsTradeAuditAdapter;
  let parsed = await adapter('parseDownloadTasks'); assert.equal(parsed.status,'found'); assert.equal(parsed.rows[0].statusCode,'pending'); assert.equal(parsed.rows[0].downloadEnabled,false);
  loading = true;
  assert.equal((await adapter('parseDownloadTasks')).status,'found','page-level loading outside the download dialog must not mask a readable list');
  loading = false;
  failed = true;
  parsed = await adapter('parseDownloadTasks');
  assert.equal(parsed.rows[0].statusCode,'failed');
  vm.runInContext(fs.readFileSync(__dirname+'/download-runner.js','utf8'), context);
  await assert.rejects(context.CHINAUMS_DOWNLOAD_RUNNER.run({
    reportType:'trade-audit',merchantNo:'89813014812B1L3',gate:{},startedAt:new Date(now).toISOString(),
    submittedMonths:[{month:'2026-09',remoteFileName:fileName,submittedAt:new Date(now).toISOString()}],
    checkpoint:async()=>{},sleep:async()=>{throw new Error('must not wait for failed generation');},transition:async()=>{},
    invoke:async op=>op==='openDownloadList'?{status:'already_open'}:adapter(op)
  }), /生成失败.*处理失败/);
  assert.equal(clicked,0);
  failed = false;
  const args = {fileName, targetMerchantNo:'89813014812B1L3', gate:{allowed:true,merchantNo:'89813014812B1L3'}};
  assert.equal((await adapter('downloadTask',args)).status,'not_ready');
  ready = true;parsed = await adapter('parseDownloadTasks');assert.equal(parsed.rows[0].statusCode,'ready');assert.equal(parsed.rows[0].downloadEnabled,true);
  const cells = row.children;
  const order = [2,3,1,0];
  headerLabels = order.map(index => ['创建时间','文件名','下载状态','操作'][index]);
  row.children = order.map(index => cells[index]);
  parsed = await adapter('parseDownloadTasks'); assert.equal(parsed.rows[0].fileName,fileName);
  assert.equal((await adapter('downloadTask',args)).status,'download_requested');assert.equal(clicked,1);
  assert.equal((await adapter('downloadTask',{...args,fileName:fileName.replace('B1L3','B06R')})).status,'blocked');assert.equal(clicked,1);
  hidden = true; assert.equal((await adapter('parseDownloadTasks')).status,'not_open');
  loading = true;
  assert.equal((await adapter('parseDownloadTasks')).status,'not_open');
  assert.equal((await adapter('openDownloadList')).status,'clicked', 'page loading must not imply an open download dialog');
  opening = 0;
  assert.equal((await adapter('openDownloadList')).status,'already_open');
  assert.deepEqual(steps,['open']);
  loading = false; hidden = true; steps.length = 0;
  vm.runInContext(fs.readFileSync(__dirname+'/download-runner.js','utf8'), context);
  ready = false; clicked = 0;
  await context.CHINAUMS_DOWNLOAD_RUNNER.run({
    reportType:'trade-audit',merchantNo:args.targetMerchantNo,gate:args.gate,
    startedAt:new Date(2026,8,30,18,13,0).toISOString(),
    submittedMonths:[{month:'2026-09',remoteFileName:fileName,submittedAt:new Date(2026,8,30,18,13,0).toISOString()}],
    checkpoint:async()=>{}, sleep:async ms=>{now+=ms;},transition:async()=>{},
    invoke:async(op, params)=>{
      if(op==='downloadTask') { steps.push('download'); assert(ready); }
      if(op==='confirmDownload') { steps.push('complete'); return {status:'download_completed',downloadId:1}; }
      return adapter(op,params);
    }
  });
  assert.deepEqual(steps,['open','close','close','open','download','complete','close']);
  assert.equal(clicked,1); assert(hidden);
  // 真实后台页面：组件已关闭，但离场动画使 DOM 仍有布局且 opacity 为 1。
  hidden = false;
  const component = {$options:{name:'ElDialog'},visible:false,$nextTick:async()=>{}};
  wrapper.__vue__ = {$parent:component}; dialog.wrapper = wrapper;
  assert.equal((await adapter('parseDownloadTasks')).status,'not_open');
  assert.equal((await adapter('closeDownloadList')).status,'already_closed');
  assert.equal((await adapter('downloadTask',args)).status,'not_open');
  loading = true;
  assert.equal((await adapter('parseDownloadTasks')).status,'not_open', 'a loading mask must not resurrect a closed dialog');
  loading = false;
  const originalLaunch = launch.click;
  launch.click = () => {component.visible = true; originalLaunch(); opening = 0;};
  assert.equal((await adapter('openDownloadList')).status,'clicked', 'closed component must be reopened despite residual visible DOM');
  await adapter('parseDownloadTasks'); now+=500;
  assert.equal((await adapter('parseDownloadTasks')).status,'found');
  const originalClose = close.click;
  autoCloseComponent = component;
  close.click = () => { originalClose(); hidden = false; };
  assert.equal((await adapter('closeDownloadList')).status,'closed','component close may complete after the click returns');
  autoCloseComponent = null;
  component.visible = true;
  close.click = () => {component.visible = false; originalClose(); hidden = false;};
  assert.equal((await adapter('closeDownloadList')).status,'closed');
  assert.equal((await adapter('parseDownloadTasks')).status,'not_open');
  component.visible = true;
  close.click = () => {};
  assert.equal((await adapter('closeDownloadList')).status,'blocked', 'an ignored close click must never claim closure');
  component.visible = false; wrapper.__vue__ = component;
  assert.equal((await adapter('parseDownloadTasks')).status,'not_open', 'the wrapper may point directly to ElDialog after transition');
  resourceAvailable = false;
  assert.equal((await adapter('openDownloadList')).status,'clicked');
  assert.equal((await adapter('parseDownloadTasks')).status,'loading','old rows cannot acknowledge a pending refresh');
  assert.equal((await adapter('downloadTask',args)).status,'not_ready');
  resourceAvailable = true;
  refreshAt = now - 100;
  assert.equal((await adapter('parseDownloadTasks')).status,'loading','prior request cannot acknowledge this refresh');
  refreshAt = now;
  assert.equal((await adapter('parseDownloadTasks')).status,'loading');
  now += 500;
  assert.equal((await adapter('parseDownloadTasks')).status,'found','unchanged rows are valid after request completion');
  component.visible = false;
  resourceStatus = 503;
  await adapter('openDownloadList');
  assert.equal((await adapter('parseDownloadTasks')).status,'refresh_error');
  assert.equal((await adapter('downloadTask',args)).status,'not_ready');
  component.visible = false; resourceAvailable = false;
  let observerDisconnected = false;
  context.PerformanceObserver = class {
    observe(options) { assert.equal(options.entryTypes[0],'resource'); }
    takeRecords() { return [{name:'https://service.chinaums.com/qryExportDtls',startTime:refreshAt,responseEnd:refreshAt+1,responseStatus:200}]; }
    disconnect() { observerDisconnected = true; }
  };
  await adapter('openDownloadList');
  await adapter('parseDownloadTasks'); now += 500;
  assert.equal((await adapter('parseDownloadTasks')).status,'found','observer survives a full resource timing buffer');
  assert.equal(observerDisconnected,true);
  console.log('PASS: loading-safe dialog opening, actual Element table layout, pending/disabled, successful downloads and foreign merchant rejection');
})().catch(e => {console.error(e);process.exitCode = 1;});

