const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function check(trade, redraw) {
  let now = 1000, busy = false, callback, disconnected = false;
  class Element {
    constructor(text = '') { this.textContent = text; this.children = []; }
    getClientRects() { return [1]; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    matches() { return false; }
    closest() { return null; }
  }
  class Input extends Element {}
  const input = new Input(); input.value = '2026/01/01 ~ 2026/01/31';
  input.parentElement = new Element('清算时间');
  const query = new Element('查询');
  query.click = () => { busy = !redraw; };
  const result = new Element();
  result.querySelectorAll = () => [new Element("商户号")];
  const target = new Element(); target.closest = () => result;
  const body = new Element(trade ? '根据查询条件共查询到 0 条记录' : '根据输入条件共查询到 0 条');
  const c = vm.createContext({
    Date: class extends Date { static now() { return now; } }, Element, HTMLInputElement: Input,
    getComputedStyle: () => ({display:'block', visibility:'visible', opacity:'1'}),
    MutationObserver: class {
      constructor(fn) { callback = fn; }
      observe() {}
      disconnect() { disconnected = true; }
    },
    location: {hostname:'service.chinaums.com', pathname:trade?'/uisportalfront/':'/uisportal/accountCheckDetailQry/toDetail', hash:'#/auditOfTrade2026'},
    document: {body, documentElement: new Element(), querySelectorAll: selector => {
      if (selector === (trade ? 'input.deal-date' : '#settDate')) return [input];
      if (selector === (trade ? 'button' : '#d_search')) return [query];
      if (selector === '.el-loading-mask,.layui-layer-loading,.loading') return busy ? [new Element()] : [];
      return [];
    }}
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/${trade?'trade-audit':'account-detail'}.js`, 'utf8'), c);
  const adapter = trade ? c.__chinaumsTradeAuditAdapter : c.__chinaumsAccountDetailAdapter;
  assert.equal((await adapter('query')).status, 'clicked');
  busy = false; // Loading completed before the first poll; result text stays identical.
  if (redraw) {
    callback([{type:"childList",target:new Element(), addedNodes:[], removedNodes:[]}]);
    now += 501;
    assert.equal((await adapter('queryState')).status, 'waiting', 'unrelated mutations must not prove a refresh');
    callback([{type:"childList",target, addedNodes:[], removedNodes:[]}]);
    now += 501;
    assert.equal((await adapter('queryState')).status, 'waiting', 'a redraw alone must not certify identical stale results');
    const mask = new Element(); mask.matches = () => true;
    callback([{type:"childList",target:new Element(), addedNodes:[], removedNodes:[mask]}]);
  }
  assert.equal((await adapter('queryState')).status, 'waiting');
  now += 501;
  assert.equal((await adapter('queryState')).status, 'no_data');
  assert(disconnected, 'query observer must disconnect after completion');
}
(async()=>{
  for (const trade of [false,true]) for (const redraw of [false,true]) await check(trade,redraw);
  console.log('PASS: both reports capture fast loading cycles; identical redraws and unrelated mutations alone stay waiting');
})().catch(e=>{console.error(e);process.exitCode=1;});
