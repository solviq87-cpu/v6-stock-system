'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../deploy/windows-host');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const install = read('TianShu-Install.ps1');
const desktop = read('TianShu-Desktop.ps1');
const cmd = read('TianShu-Install.cmd');

test('Windows PowerShell 5.1 Chinese entrypoints have UTF-8 BOM', () => {
  assert.ok(install.startsWith('\uFEFF'));
  assert.ok(desktop.startsWith('\uFEFF'));
  assert.match(desktop, /Microsoft YaHei UI/);
});

test('installer verifies all bundled file hashes, provenance, and unknown files before copying', () => {
  for (const check of ['SHA256SUMS.txt', 'Get-FileHash', 'sourceSha', 'controlsSourceSha',
    'Get-ChildItem', 'ReparsePoint', 'manifest.json', 'TianShu-Desktop.ps1']) {
    assert.ok(install.includes(check), check);
  }
  assert.match(install, /Verify-Package \$source/);
  assert.match(install, /Verify-Package \$stage/);
  assert.match(install, /previous-/);
  assert.match(install, /Move-Item -LiteralPath \$previous -Destination \$target/);
  assert.doesNotMatch(install, /wsl\.exe|Run-Host 'Initialize'|Run-Host 'ApplyUpdate'|New-NetFirewallRule|tailscale funnel/i);
});

test('GUI uses existing host safety controller, not direct service or ledger commands', () => {
  assert.match(desktop, /windows-host\.ps1/);
  for (const action of ["'Start'", "'Stop'", "'Status'", "'Open'", "'Update'"]) {
    assert.ok(desktop.includes(action), action);
  }
  assert.match(desktop, /WindowStyle Hidden/);
  assert.match(desktop, /AutoStart/);
  assert.match(desktop, /Get-State/);
  assert.doesNotMatch(desktop, /git clone|git pull|npm install|Run-Host 'Initialize'|Run-Host 'ApplyUpdate'|0\.0\.0\.0|tailscale funnel|wsl --shutdown/i);
});

test('login autorun is opt-in and protects existing foreign startup shortcuts', () => {
  assert.match(desktop, /GetFolderPath\('Startup'\)/);
  assert.match(desktop, /Startup-IsOurs/);
  assert.match(desktop, /-Mode AutoStart/);
  assert.match(desktop, /拒绝修改/);
  assert.match(desktop, /DialogResult]::Yes/);
  assert.match(desktop, /if \(\$Mode -eq 'AutoStart'\)/);
  const autorun = desktop.split("if ($Mode -eq 'AutoStart')")[1].split('Add-Type')[0];
  assert.match(autorun, /Run-Host 'Start'/);
  assert.doesNotMatch(autorun, /Run-Host 'Update'|Run-Host 'Stop'/);
});

test('double-click entry performs installer only and makes no global policy change', () => {
  assert.match(cmd, /TianShu-Install\.ps1/);
  assert.match(cmd, /-Mode Install/);
  assert.doesNotMatch(cmd, /Set-ExecutionPolicy|wsl --install|format|rmdir|git pull/i);
});

test('exact-SHA host bundle includes new controllers as launchers', () => {
  const builder = fs.readFileSync(path.resolve(__dirname, '../scripts/build-windows-host-bundle.py'), 'utf8');
  assert.match(builder, /SUFFIXES = \{'.sh', '.js', '.ps1', '.cmd', '.md', '.json'\}/);
  assert.match(builder, /files\.update\(launchers\)/);
  assert.match(builder, /SHA256SUMS\.txt/);
});
