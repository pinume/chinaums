const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/popup.js', 'utf8');
const listeners = {}, urls = [];
const button = name => ({addEventListener: (event, fn) => {listeners[name] = fn;}});
const context = vm.createContext({URL,
  elements: {error:{},startExportTestButton:button('detail'),startTradeExportButton:button('trade')},
  routeForUrl: () => ({kind:'portal_page'}),refreshExportTestButton:async()=>{},window:{close(){}},
  chrome:{tabs:{query:async()=>[{id:7,url:'https://service.chinaums.com/uisportal/accountCheckDetailQry/toDetail'}],create:async args=>urls.push(new URL(args.url))},runtime:{getURL:path=>'chrome-extension://test/'+path}}
});
vm.runInContext(source.slice(source.indexOf('const startExport ='),source.indexOf('elements.detailsButton.addEventListener')),context);
(async()=>{
  await listeners.detail();await listeners.trade();
  assert.equal(urls[0].searchParams.get('reportType'),'account-detail');
  assert.equal(urls[1].searchParams.get('reportType'),'trade-audit');
  assert.equal(urls[1].searchParams.get('tabId'),'7');
  const html = fs.readFileSync(__dirname+'/popup.html','utf8');
  assert(html.includes('id="start-export-test-button"'));assert(html.includes('id="start-trade-export-button"'));
  console.log('PASS: two separate buttons explicitly start their own reports from the same portal');
})().catch(e=>{console.error(e);process.exitCode=1;});
