const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/../export-runner.js`, 'utf8');
const elements = Object.fromEntries(['result', 'resultTitle', 'resultMessage', 'status', 'stage', 'month', 'progress', 'downloadProgress', 'gate'].map(name => [name, {
  attributes: {}, scrolls: 0,
  setAttribute(key, value) { this.attributes[key] = value; },
  scrollIntoView() { this.scrolls++; }
}]));
const context = vm.createContext({elements, document: {}, state: null, reportType: 'account-detail', updateButtons() {}});
vm.runInContext(source.slice(source.indexOf('let lastResultStatus ='), source.indexOf('const sleep =')) +
  source.slice(source.indexOf('const renderState ='), source.indexOf('const transition =')) +
  '\nglobalThis.render = renderState; globalThis.result = renderResult;', context);
const render = (status, downloads = 0, count = 2) => {
  context.state = {status, error: '暂存列表关闭结果无法确认。', monthOrder: ['2026-01', '2026-02'],
    months: Object.fromEntries([1, 2].map((month, index) => [month, {status: index < count ? 'SUBMITTED' : 'NO_DATA',
      downloadStatus: index < downloads ? 'COMPLETED' : 'REQUESTED'}]))};
  context.render();
};
render('WAITING_GENERATION');
assert.equal(elements.result.hidden, true);
assert.equal(elements.status.textContent, '等待文件生成');
render('COMPLETED', 2);
assert.equal(elements.result.hidden, false);
assert.match(elements.result.className, /success/);
assert.match(elements.resultTitle.textContent, /导出完成/);
assert.match(elements.resultMessage.textContent, /2 \/ 2/);
assert.equal(elements.result.attributes.role, 'status');
context.render();
assert.equal(elements.result.scrolls, 1, 'repeated renders must not steal the scroll position');
render('BLOCKED', 1);
assert.match(elements.result.className, /failure/);
assert.match(elements.resultMessage.textContent, /关闭结果无法确认/);
assert.match(elements.resultMessage.textContent, /1 \/ 2/);
assert.equal(elements.result.attributes.role, 'alert');
assert.match(context.document.title, /导出失败/);
render('STOPPED', 1);
assert.match(elements.result.className, /stopped/);
assert.match(elements.resultTitle.textContent, /已停止/);
assert.equal(elements.result.attributes.role, 'status');
render('COMPLETED', 0, 0);
assert.match(elements.resultTitle.textContent, /本轮无数据/);
assert(!elements.resultTitle.textContent.includes('导出完成'));
context.result('BLOCKED', '导出参数无效。');
assert.match(elements.resultMessage.textContent, /导出参数无效/);
assert.equal(elements.result.hidden, false);
assert.match(context.document.title, /导出失败/);
const startupElements = new Map();
const startup = vm.createContext({URLSearchParams, Date, Intl, location: {search: '?tabId=0'}, window: {setTimeout, clearTimeout},
  document: {querySelector(selector) {
    if (!startupElements.has(selector)) startupElements.set(selector, {addEventListener() {}, setAttribute() {}, scrollIntoView() {}});
    return startupElements.get(selector);
  }}
});
vm.runInContext(fs.readFileSync(`${__dirname}/../site-config.js`, 'utf8'), startup);
vm.runInContext(source, startup);
setImmediate(() => {
  assert.equal(startupElements.get('#export-result').hidden, false);
  assert.match(startupElements.get('#export-result-message').textContent, /导出参数无效/);
  assert.equal(startupElements.get('#export-close').disabled, false);
  assert.equal(startupElements.get('#export-back').tabIndex, 0);
  console.log('PASS: visible success, partial failure, no data, user stop, startup failure, Chinese status and one-time scroll');
});
