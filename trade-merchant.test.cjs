const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let now = 1000;
let merchantValues = ['89813014812B1L3'];
let rowSignature = 'before';
let exportClicks = 0;
let apiCalls = 0;
let token = 'TEST_TOKEN';
let responseData = {success:true,code:'000000',message:'成功',data:null};
let lastCall = null;
class Element {
  constructor(text = '', children = []) { this.text = text; this.children = children; this.classList = {contains: () => false}; }
  get textContent() { return typeof this.text === 'function' ? this.text() : this.text; }
  get innerText() { return this.textContent; }
  getClientRects() { return [1]; }
  querySelectorAll(selector) {
    if (selector === '.cell') return [this];
    if (selector === '.el-table__header-wrapper thead th') return [new Element('交易金额')];
    if (selector === '.el-table__body-wrapper tbody > tr') return merchantValues.map(value => new Element(() => `${rowSignature} ${value}`, [new Element(value)]));
    return [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest() { return null; }
}
const input = new Element(); input.value = '2026/09/01 ~ 2026/09/30';
const query = new Element('查询'); query.click = () => { rowSignature = `after-${now}`; };
const exportButton = new Element('批量导出'); exportButton.click = () => exportClicks++;
const listButton = new Element('下载暂存列表');
const table = new Element();
table.querySelectorAll = selector => selector === '.el-table__header-wrapper thead th' ? [new Element('交易金额')]
  : selector === '.el-table__body-wrapper tbody > tr' ? merchantValues.map(value => new Element(() => `${rowSignature} ${value}`, [new Element(value)])) : [];
table.closest = () => null;
const component = {
  $options:{name:'table'},
  get tableData(){return merchantValues.map(mchntId=>({mchntId}));},
  $axiosApi:{axiosPromisePara:async (payload,endpoint,options) => {apiCalls++;lastCall={payload,endpoint,options};return responseData;}}
};
table.__vue__ = {$parent: component};
const context = vm.createContext({
  Date: class extends Date { static now() { return now; } },
  AbortSignal,
  localStorage:{getItem:key=>{assert.equal(key,'userPortalVerifyToken');return token;}},
  location: {hostname:'service.chinaums.com',pathname:'/uisportalfront/',hash:'#/auditOfTrade2026'},
  Element, getComputedStyle: () => ({display:'block',visibility:'visible',opacity:'1'}),
  document: {body:new Element('根据查询条件共查询到 1 条记录'),
    querySelectorAll: selector => {
      if (selector === 'input.deal-date') return [input];
      if (selector === 'button') return [query, exportButton, listButton];
      if (selector === '.el-loading-mask,.layui-layer-loading,.loading') return [];
      if (selector === '.el-table') return [table];
      if (selector === '.el-table__body-wrapper tbody > tr') return table.querySelectorAll(selector);
      if (selector === '.el-table__empty-text,.el-empty__description') return [];
      return [];
    }}
});
vm.runInContext(fs.readFileSync(`${__dirname}/trade-audit.js`, 'utf8'), context);
async function ready(adapter) {
  assert.equal((await adapter('query')).status, 'clicked');
  assert.equal((await adapter('queryState', {targetMerchantId:'89813014812B1L3'})).status, 'waiting');
  now += 501;
  return adapter('queryState', {targetMerchantId:'89813014812B1L3'});
}
(async () => {
  const adapter = context.__chinaumsTradeAuditAdapter;
  assert.equal((await ready(adapter)).status, 'ready');
  merchantValues = ['OTHER'];
  const gate = {allowed:true,merchantId:'89813014812B1L3',authentication:{status:'logged_in',confidence:'high'}};
  assert.equal((await adapter('submitExport',{gate,targetMerchantId:'89813014812B1L3'})).status,'blocked');
  assert.equal(exportClicks,0);
  merchantValues = ['89813014812B1L3'];
  let result = await adapter('submitExport',{gate,targetMerchantId:'89813014812B1L3'});
  assert.equal(result.status,'accepted');
  assert.equal(result.source,'api');
  assert.equal(apiCalls,1);
  assert.equal(exportClicks,0);
  assert.equal(lastCall.endpoint,'uis-tradein-server/portal/yjhx/v3/applyExport');
  assert.deepEqual(JSON.parse(JSON.stringify(lastCall.payload)),{
    merOrderId:'',transRef:'',statusList:[],beginTransDate:'20260901',endTransDate:'20260930'
  });
  assert.equal(lastCall.options.headers.userPortalToken,'TEST_TOKEN');
  assert(lastCall.options.signal instanceof AbortSignal);

  responseData={success:false,code:'999999',message:'当前已经有超过12条申请在处理中，请稍后',data:null};
  result=await adapter('submitExport',{gate,targetMerchantId:'89813014812B1L3'});
  assert.equal(result.status,'throttled');
  assert.equal(result.source,'api');

  responseData={success:false,code:'999999',message:'系统异常',data:null};
  result=await adapter('submitExport',{gate,targetMerchantId:'89813014812B1L3'});
  assert.equal(result.status,'unknown');

  token='';
  const callsBeforeToken=apiCalls;
  result=await adapter('submitExport',{gate,targetMerchantId:'89813014812B1L3'});
  assert.equal(result.status,'blocked');
  assert.equal(apiCalls,callsBeforeToken);
  token='TEST_TOKEN';

  input.value='2026/09/02 ~ 2026/09/30';
  const callsBeforeDate=apiCalls;
  result=await adapter('submitExport',{gate,targetMerchantId:'89813014812B1L3'});
  assert.equal(result.status,'blocked');
  assert.equal(apiCalls,callsBeforeDate);
  input.value='2026/09/01 ~ 2026/09/30';

  merchantValues = [''];
  assert.equal((await ready(adapter)).status,'failed');
  merchantValues = ['89813014812B1L3','OTHER'];
  assert.equal((await ready(adapter)).status,'failed');
  assert.equal(apiCalls,3);
  assert.equal(exportClicks,0);
  console.log('PASS: trade direct applyExport payload, success/throttle/unknown, token/date guards and merchant identity');
})().catch(error => { console.error(error); process.exitCode = 1; });
