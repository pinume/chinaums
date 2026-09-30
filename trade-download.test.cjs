const assert = require('node:assert/strict');
require('./download-runner.js');
const tasks = Array.from({length:12},(_,i)=>({fileName:`MER_89813014812B1L3_202609301813${String(i).padStart(2,'0')}_yjhx.xlsx`,createdAt:`2026-09-30 18:13:${String(i).padStart(2,'0')}`,statusCode:'ready',downloadEnabled:true}));
const originalNow = Date.now;
let now = new Date(2026,8,30,18,13,0).getTime();
Date.now=()=>now;
const mixed = process.argv.includes("mixed");
if (mixed) tasks[1].fileName = tasks[1].fileName.replace("B1L3", "B06R");
let page = 1, opened = false, nextCalls = 0, dataPage = 1, pendingReads = 0, delayedTimer = false;
const clicked = [], completed = [], delays = [];
(async()=>{
  await CHINAUMS_DOWNLOAD_RUNNER.run({reportType:'trade-audit',merchantNo:'',onMerchantIdentified:async value=>assert.equal(value,'89813014812B1L3'),startedAt:new Date(2026,8,30,18,13,0,500).toISOString(),submittedMonths:tasks.map((t,i)=>({month:`2026-${String(i+1).padStart(2,'0')}`,submittedAt:new Date(2026,8,30,18,13,i,500).toISOString(),remoteFileName:t.fileName})),gate:{allowed:true,merchantNo:'89813014812B1L3'},checkpoint:async()=>{},sleep:async ms=>{delays.push(ms);now+=ms;if(ms===200 && !delayedTimer){now+=20000;delayedTimer=true;}},transition:async event=>{if(event.status==='DOWNLOAD_COMPLETED')completed.push(event.month);},invoke:async(op,args)=>{
    if(op==='openDownloadList'){opened=true;return{status:'clicked'};}
    if(op==='parseDownloadTasks'){if(pendingReads && --pendingReads===0)dataPage=page;return{status:opened?'found':'not_open',page,total:12,hasNext:page===1,rows:tasks.slice().reverse().slice((dataPage-1)*10,dataPage*10)};}
    if(op==='nextDownloadPage'){page++;nextCalls++;pendingReads=nextCalls===1?2:30;return{status:'clicked'};}
    if(op==='selectDownloadPage'){page=args.page;pendingReads=30;return{status:'clicked'};}
    if(op==='downloadTask'){assert.equal(dataPage,page,'target rows must finish loading before download');assert.equal(completed.length,clicked.length);clicked.push(args.fileName);return{status:'download_requested'};}
    if(op==='confirmDownload')return{status:'download_completed',downloadId:clicked.length};
    if(op==='closeDownloadList'){opened=false;return{status:'closed'};}
    throw new Error(op);
  }});
  assert.equal(nextCalls,1);assert.equal(clicked.length,12);assert.equal(new Set(clicked).size,12);assert.deepEqual(clicked,tasks.map(t=>t.fileName));assert.equal(completed[0],'2026-01');assert.equal(completed[11],'2026-12');assert.equal(delays.filter(ms=>ms===5000).length,12);assert.equal(opened,false);
  console.log('PASS: trade 12 exact task files across two pages with delayed row updates, second precision, sequential completion and 5-second gaps');
})().catch(e=>{if (mixed) {assert.match(e.message,/多个商户/);assert.equal(clicked.length,0);console.log("PASS: mixed merchant tasks stop before any download");} else {console.error(e);process.exitCode=1;}}).finally(()=>{Date.now=originalNow;});
