const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const files = fs.readdirSync(__dirname).sort();
const checks = [
  ...files.filter(name => name.endsWith('.js')).map(name => ['--check', path.join(__dirname, name)]),
  ...files.filter(name => name.endsWith('.test.cjs')).map(name => [path.join(__dirname, name)]),
  [path.join(__dirname, 'export-runner.test.cjs'), 'COMPLETED'],
  [path.join(__dirname, 'export-runner.test.cjs'), 'BLOCKED', 'LIST_OPEN'],
  [path.join(__dirname, 'export-runner.test.cjs'), 'BLOCKED', 'LIST_OPEN', 'trade-audit'],
  [path.join(__dirname, 'export-runner.test.cjs'), 'WAITING_GENERATION'],
  [path.join(__dirname, 'export-runner.test.cjs'), 'BLOCKED', 'trade-audit'],
  [path.join(__dirname, 'trade-download.test.cjs'), 'mixed'],
  [path.join(__dirname, 'export-runner.test.cjs'), 'STOPPED'],
  [path.join(__dirname, 'export-runner.test.cjs'), 'STOPPED', 'trade-audit']
];
for (const args of checks) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', timeout: 30000 });
  if (result.error || result.status !== 0) {
    console.error('FAIL:', args.join(' '), result.error?.message || '');
    process.exit(1);
  }
}
console.log(`PASS: ${checks.length} syntax and regression checks`);
