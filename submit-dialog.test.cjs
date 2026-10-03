const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function scenario({delay = 3, duplicate = false, label = '关闭', text = '申请已提交', stuck = false} = {}) {
  let ticks = 0, clicks = 0, outsideClicks = 0;
  class Element {
    constructor(text = '') { this.textContent = text; this.open = true; }
    getClientRects() { return this.open ? [1] : []; }
    querySelectorAll() { return []; }
  }
  const dialog = new Element(text);
  const button = new Element(label);
  button.click = () => { clicks++; };
  dialog.querySelectorAll = selector => selector === 'button' ? [button] : [];
  const outside = new Element(label);
  outside.click = () => { outsideClicks++; };
  const dialogs = duplicate ? [dialog, new Element(text)] : [dialog];
  const context = vm.createContext({
    Element, location: {hostname: 'service.chinaums.com', pathname: '/uisportalfront', hash: '#/auditOfTrade2026'},
    getComputedStyle: () => ({display: 'block', visibility: 'visible', opacity: '1'}),
    document: {querySelectorAll: selector => selector === 'button' ? [outside, button] : dialogs},
    setTimeout: fn => { ticks++; if (clicks && ticks >= delay && !stuck) dialog.open = false; fn(); }
  });
  vm.runInContext(fs.readFileSync(__dirname + '/trade-audit.js', 'utf8'), context);
  const result = await context.__chinaumsTradeAuditAdapter('closeSubmitDialog');
  assert.equal(outsideClicks, 0);
  return {result, ticks, clicks};
}

(async () => {
  const delayed = await scenario();
  assert.equal(delayed.result.status, 'closed');
  assert.equal(delayed.ticks, 3);
  assert.equal(delayed.clicks, 1);
  const stuck = await scenario({stuck: true});
  assert.equal(stuck.result.status, 'blocked');
  assert.equal(stuck.ticks, 30);
  assert.match(stuck.result.reason, /仍未消失/);
  const duplicate = await scenario({duplicate: true});
  assert.equal(duplicate.result.status, 'blocked');
  assert.equal(duplicate.clicks, 0);
  assert.equal((await scenario({text: '超过 5 条申请在处理中', label: '确认'})).result.status, 'closed');
  console.log('PASS: scoped submit dialog, delayed close, failed close and ambiguous dialogs');
})().catch(error => { console.error(error); process.exitCode = 1; });
