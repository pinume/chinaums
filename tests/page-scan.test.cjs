const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(text, tagName = 'DIV', attributes = {}) {
    this.innerText = this.textContent = text;
    this.tagName = tagName;
    this.attributes = attributes;
    this.href = attributes.href;
  }
  getAttribute(name) { return this.attributes[name] || null; }
  hasAttribute(name) { return name in this.attributes; }
  getClientRects() { return [{}]; }
}
const location = { hostname: 'service.chinaums.com', pathname: '/uisportal/index_r',
  href: 'https://service.chinaums.com/uisportal/index_r' };
const window = { location, getComputedStyle: () => ({cursor: 'default'}) };
window.top = window;
const context = vm.createContext({URL, Element, HTMLInputElement: Element, window});
vm.runInContext(fs.readFileSync(`${__dirname}/../site-config.js`, 'utf8'), context);
const config = context.CHINAUMS_SITE_CONFIG;
const navigation = config.mainNavigation.map(item => new Element(item.label, 'A',
  {href: `https://${config.host}${item.path}`}));
let password = false;
context.document = {
  title: '银联商务', body: {innerText: '商户名称：测试商户有限公司'},
  querySelector: () => new Element('当前商户：测试商户有限公司'),
  querySelectorAll: selector => selector === 'a[href]' ? navigation
    : selector === 'input,select,textarea' && password ? [new Element('', 'INPUT', {type:'password'})] : []
};
for (const file of ['auth.js', 'content.js']) {
  vm.runInContext(fs.readFileSync(`${__dirname}/../${file}`, 'utf8'), context);
}
const scan = () => context.__chinaumsAssistantScan(config);
const classify = snapshot => context.CHINAUMS_AUTH.classify(snapshot.url, [snapshot],
  snapshot.mainNavigation, snapshot.businessEntries);
const snapshot = scan();
assert.equal(snapshot.merchant.current, '测试商户有限公司');
assert.equal(snapshot.merchant.source, 'merchant-panel');
assert.equal(snapshot.signals.accountCue, true);
assert.equal(classify(snapshot).status, 'logged_in');
assert.equal(classify(snapshot).confidence, 'high');
password = true;
assert.equal(classify(scan()).status, 'logged_out');
window.location.hostname = 'other.example';
assert.equal(scan(), null);
console.log('PASS: page scan preserves current merchant and login signals without a fixed target merchant');
