const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function scenario({duplicate = false, label = '关闭', text = '申请已提交', stuck = false, synchronous = false, otherDialog = false, initiallyClosed = false, lingeringDom = false} = {}) {
  let timerCalls = 0, clicks = 0, outsideClicks = 0, disconnected = false, timerCleared = false;
  class Element {
    constructor(text = '') { this.textContent = text; this.open = true; }
    getClientRects() { return this.open ? [1] : []; }
    querySelectorAll() { return []; }
  }
  const dialog = new Element(text);
  const wrapper = {__vue__:{visible:!initiallyClosed}};
  dialog.closest = selector => selector.includes('message-box__wrapper') ? wrapper : null;
  if (initiallyClosed) dialog.open = false;
  const button = new Element(label);
  button.click = () => {
    clicks++;
    if (synchronous) { dialog.open = false; wrapper.__vue__.visible = false; }
  };
  dialog.querySelectorAll = selector => selector === 'button' ? [button] : [];
  const outside = new Element(label);
  outside.click = () => { outsideClicks++; };
  const dialogs = duplicate ? [dialog, new Element(text)] : [dialog];
  if (otherDialog) dialogs.push(new Element('其他提示'));
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe() {
      // 即使后台短计时器没有运行，DOM 关闭事件仍必须完成操作。
      if (!stuck) Promise.resolve().then(() => {
        wrapper.__vue__.visible = false;
        if (!lingeringDom) dialog.open = false;
        this.callback();
      });
    }
    disconnect() { disconnected = true; }
  }
  const context = vm.createContext({
    Element, location: {hostname: 'service.chinaums.com', pathname: '/uisportalfront', hash: '#/auditOfTrade2026'},
    getComputedStyle: () => ({display: 'block', visibility: 'visible', opacity: '1'}),
    MutationObserver: Observer,
    document: {documentElement: {}, querySelectorAll: selector => selector === 'button' ? [outside, button] : dialogs},
    setTimeout: (fn, delay) => {
      assert.ok(delay > 0 && delay <= 8000);
      timerCalls++;
      if (stuck || otherDialog) Promise.resolve().then(fn);
      return 1;
    },
    clearTimeout: () => { timerCleared = true; }
  });
  vm.runInContext(fs.readFileSync(__dirname + '/trade-audit.js', 'utf8'), context);
  const result = await context.__chinaumsTradeAuditAdapter('closeSubmitDialog');
  assert.equal(outsideClicks, 0);
  return {result, timerCalls, clicks, disconnected, timerCleared};
}

(async () => {
  const alreadyClosed = await scenario({initiallyClosed:true});
  assert.equal(alreadyClosed.result.status, "closed");
  assert.equal(alreadyClosed.clicks, 0);
  const delayed = await scenario();
  assert.equal(delayed.result.status, 'closed');
  assert.equal(delayed.timerCalls, 1);
  assert.equal(delayed.disconnected, true);
  assert.equal(delayed.timerCleared, true);
  assert.equal(delayed.clicks, 1);
  const lingering = await scenario({lingeringDom:true});
  assert.equal(lingering.result.status, 'closed', 'closed Vue state must win over a lingering leave-animation DOM');
    const stuck = await scenario({stuck: true});
  assert.equal(stuck.result.status, 'blocked');
  assert.equal(stuck.timerCalls, 1);
  assert.match(stuck.result.reason, /仍未就绪/);
  const duplicate = await scenario({duplicate: true});
  assert.equal(duplicate.result.status, 'blocked');
  assert.equal(duplicate.clicks, 0);
  const synchronous = await scenario({synchronous:true});
  assert.equal(synchronous.result.status, 'closed');
  assert.equal(synchronous.timerCalls, 0);
  assert.equal((await scenario({otherDialog:true})).result.status, 'blocked');
  assert.equal((await scenario({text: '超过 5 条申请在处理中', label: '确认'})).result.status, 'closed');
  console.log('PASS: scoped submit dialog, delayed close, failed close and ambiguous dialogs');
})().catch(error => { console.error(error); process.exitCode = 1; });
