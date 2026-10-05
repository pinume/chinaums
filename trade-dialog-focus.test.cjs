const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(text = '') { this.textContent = text; this.parentElement = null; this.disabled = false; }
  getClientRects() { return [1]; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}
const document = {
  activeElement: null,
  querySelectorAll(selector) { return selector === 'button' ? [button] : []; }
};
const button = new Element('下载暂存列表');
button.focus = () => { document.activeElement = button; };
button.click = () => assert.equal(document.activeElement, button, 'download list opener must own focus before dialog opens');

const context = vm.createContext({
  Element,
  document,
  performance: { now: () => 0, getEntriesByType: () => [] },
  getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  location: { hostname: 'service.chinaums.com', pathname: '/uisportalfront/', hash: '#/auditOfTrade2026' },
  setTimeout,
  clearTimeout
});
vm.runInContext(fs.readFileSync(`${__dirname}/trade-audit.js`, 'utf8'), context);

(async () => {
  const result = await context.__chinaumsTradeAuditAdapter('openDownloadList');
  assert.equal(result.status, 'clicked');
  assert.equal(document.activeElement, button);
  console.log('PASS: trade download list button receives focus before programmatic click');
})().catch((error) => { console.error(error); process.exitCode = 1; });
