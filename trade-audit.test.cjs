const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(text = '', classes = []) { this.textContent = text; this.classList = { contains: name => classes.includes(name) }; }
  getClientRects() { return [1]; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll() { return []; }
  click() {}
}
let opened = false, month = 9, picked = [], pending = 0, neverOpen = false, focused = false;
const input = new Element(); input.value = ''; input.blur = () => { focused = false; }; input.focus = () => { if (!focused) { pending = 3; picked = []; focused = true; } }; input.click = () => {};
const confirm = new Element('确定');
confirm.click = () => { input.value = picked.map(day => `2026/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`).join(' ~ '); opened = false; };
const panel = new Element();
panel.querySelectorAll = selector => {
  if (selector === '.laydate-set-ym') return [new Element(`2026年 ${month}月`)];
  if (selector === '.laydate-prev-m' || selector === '.laydate-next-m') {
    const arrow = new Element(); arrow.click = () => { month += selector.includes('prev') ? -1 : 1; }; return [arrow];
  }
  if (selector === '.layui-laydate-content td') return Array.from({length: new Date(2026, month, 0).getDate()}, (_, i) => {
    const cell = new Element(String(i + 1), month > 9 ? ['laydate-disabled'] : []);
    cell.click = () => picked.push(i + 1); return cell;
  });
  return [];
};
const calendar = new Element();
calendar.querySelectorAll = selector => selector === '.layui-laydate-main' ? [panel] : selector === 'span.laydate-btns-confirm' ? [confirm] : [];
const context = vm.createContext({
  Element, location: {hostname: 'service.chinaums.com', pathname: '/uisportalfront/', hash: '#/auditOfTrade2026'},
  getComputedStyle: () => ({display: 'block', visibility: 'visible', opacity: '1'}),
  document: {querySelectorAll: selector => selector === 'input.deal-date' ? [input] : selector === '.layui-laydate' && opened ? [calendar] : []},
  setTimeout: fn => { if (pending && !neverOpen && --pending === 0) opened = true; fn(); }, Date
});
vm.runInContext(fs.readFileSync(__dirname + '/trade-audit.js', 'utf8'), context);
(async () => {
  const adapter = context.__chinaumsTradeAuditAdapter;
  for (let m = 1; m <= 9; m++) {
    const end = new Date(2026, m, 0).getDate();
    const result = await adapter('setDateRange', {start: `2026-${String(m).padStart(2, '0')}-01`, end: `2026-${String(m).padStart(2, '0')}-${end}`});
    assert.equal(result.status, 'set', JSON.stringify(result));
    assert.equal(input.value, `2026/${String(m).padStart(2, '0')}/01 ~ 2026/${String(m).padStart(2, '0')}/${end}`);
  }
  const disabled = await adapter('setDateRange', {start: '2026-10-01', end: '2026-10-31'});
  assert.equal(disabled.status, 'failed');
  assert.deepEqual(picked, []);
  opened = false; neverOpen = true;
  const missing = await adapter('setDateRange', {start: '2026-01-01', end: '2026-01-31'});
  assert.equal(missing.status, 'failed'); assert.match(missing.reason, /3 秒/);
  assert.deepEqual(picked, []);
  console.log('PASS: January–September date ranges, month arrows, input readback and disabled future days');
})().catch(error => { console.error(error); process.exitCode = 1; });
