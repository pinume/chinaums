const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const files = fs.readdirSync(__dirname).sort();
const testDir = path.join(__dirname, 'tests');
const testFiles = fs.readdirSync(testDir).sort();
const checks = [
  ...files.filter(name => name.endsWith('.js')).map(name => ['--check', path.join(__dirname, name)]),
  ...testFiles.filter(name => name.endsWith('.test.cjs')).map(name => [path.join(testDir, name)]),
  [path.join(testDir, 'export-runner.test.cjs'), 'COMPLETED'],
  [path.join(testDir, 'export-runner.test.cjs'), 'WAITING_GENERATION'],
  [path.join(testDir, 'export-runner.test.cjs'), 'BLOCKED', 'trade-audit'],
  [path.join(testDir, 'trade-download.test.cjs'), 'mixed'],
  [path.join(testDir, 'export-runner.test.cjs'), 'UNKNOWN'],
  [path.join(testDir, 'export-runner.test.cjs'), 'UNKNOWN', 'trade-audit'],
  [path.join(testDir, 'export-runner.test.cjs'), 'STOPPED'],
  [path.join(testDir, 'export-runner.test.cjs'), 'STOPPED', 'trade-audit']
];
for (const args of checks) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', timeout: 30000 });
  if (result.error || result.status !== 0) {
    console.error('FAIL:', args.join(' '), result.error?.message || '');
    process.exit(1);
  }
}
console.log(`PASS: ${checks.length} syntax and regression checks`);
