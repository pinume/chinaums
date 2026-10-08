const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor() {
    this.attributes = {};
    this.removed = false;
  }
  getClientRects() { return [1]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { this.removed = true; }
  closest() { return null; }
}
const appended = [];
const body = new Element();
body.append = (element) => appended.push(element);

const context = vm.createContext({
  Element,
  Date,
  encodeURIComponent,
  location: { protocol: "https:", hostname: "service.chinaums.com", pathname: "/uisportal/accountCheckDetailQry/toDetail" },
  getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
  document: {
    body,
    querySelectorAll: () => [],
    createElement: (tag) => {
      assert.equal(tag, "iframe");
      return new Element();
    }
  },
  setTimeout: (fn, ms) => {
    assert.equal(ms, 60000);
    fn();
    return 1;
  },
  clearTimeout: () => {}
});
vm.runInContext(fs.readFileSync(`${__dirname}/../account-detail.js`, "utf8"), context);

const merchantNo = "89813015722APT1";
const args = {
  gate: { allowed: true, merchantNo },
  targetMerchantNo: merchantNo,
  taskId: "0c057e50442143a68dbf9339784f2127",
  fileName: `${merchantNo}_MX_20261005133427.xlsx`
};

(async () => {
  const adapter = context.__chinaumsAccountDetailAdapter;
  let result = await adapter("downloadTaskDirect", args);
  assert.equal(result.status, "download_requested");
  assert.equal(result.url, "https://service.chinaums.com/uisportal/commonController/exportDeailBill?exportId=0c057e50442143a68dbf9339784f2127");
  assert.equal(appended.length, 0, "adapter must not create an iframe");

  result = await adapter("downloadTaskDirect", { ...args, gate: { allowed: false, merchantNo } });
  assert.equal(result.status, "blocked");
  result = await adapter("downloadTaskDirect", { ...args, fileName: "OTHER_MX_20261005133427.xlsx" });
  assert.equal(result.status, "blocked");
  result = await adapter("downloadTaskDirect", { ...args, taskId: "../bad" });
  assert.equal(result.status, "blocked");
  assert.equal(appended.length, 0, "guard failures must not start another download request");

  console.log("PASS: account direct download uses exact exportId URL and blocks gate, merchant, or task identity drift");
})().catch((error) => { console.error(error); process.exitCode = 1; });
