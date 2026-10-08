const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function check(mode) {
  const elements = new Map(), urls = [];
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {disabled: true, listeners: {}, addEventListener(event, fn) {this.listeners[event] = fn;}});
    return elements.get(selector);
  };
  let resolveScan, rejectScan;
  const scanning = new Promise((resolve, reject) => {resolveScan = resolve; rejectScan = reject;});
  const tab = {id: 7, url: 'https://service.chinaums.com/uisportal/index_r'};
  const context = vm.createContext({URL, Date, window:{close(){}}, document:{querySelector:element},
    chrome:{tabs:{query:async()=>[tab],create:async args=>urls.push(new URL(args.url))},
      runtime:{getURL:path=>'chrome-extension://test/'+path},
      scripting:{executeScript:async args=>args.files ? [] : scanning}}
  });
  for (const name of ['site-config.js', 'auth.js', 'popup.js']) {
    vm.runInContext(fs.readFileSync(`${__dirname}/../${name}`, 'utf8'), context);
  }
  await tick();
  assert.equal(element('#login-status').textContent, '检测中…');
  assert.equal(element('#start-export-test-button').disabled, true);
  if (mode === 'error') rejectScan(new Error('scan failed'));
  else resolveScan([{frameId:0,result:{url:tab.url,isTopFrame:true,mainNavigation:[],businessEntries:[],
    merchant:{current:'测试商户有限公司',source:'merchant-panel'},
    signals:{accountCue:mode === 'logged_in',hasPasswordInput:mode === 'logged_out'}}}]);
  await tick();
  const ready = mode === 'logged_in';
  assert.equal(element('#start-export-test-button').disabled, !ready, mode);
  assert.equal(element('#start-trade-export-button').disabled, !ready, mode);
  if (ready) {
    assert.equal(element('#login-status').textContent, '✓ 已登录');
    assert.equal(element('#merchant-name').textContent, '测试商户有限公司');
    await element('#start-export-test-button').listeners.click();
    await element('#start-trade-export-button').listeners.click();
    assert.equal(urls[0].searchParams.get('reportType'), 'account-detail');
    assert.equal(urls[1].searchParams.get('reportType'), 'trade-audit');
    assert.equal(urls[1].searchParams.get('tabId'), '7');
    tab.id = 8;
  }
  await element('#start-export-test-button').listeners.click();
  assert.equal(urls.length, ready ? 2 : 0, 'unverified tabs must not start exports');
  if (mode === 'error') assert.notEqual(element('#login-status').textContent, '检测中…');
}
(async()=>{
  for (const mode of ['logged_in', 'logged_out', 'medium', 'error']) await check(mode);
  console.log('PASS: full popup waits for login verification, blocks unverified tabs and starts both reports');
})().catch(error=>{console.error(error);process.exitCode=1;});
