// Compute the mod's content digest with Folia's OWN modDigest.cjs.
//
// Folium binds trust to a digest over EVERY file in the mod directory, so this
// script doubles as a "what will the host hash?" check and as a guard that the
// installed directory contains nothing but mod.json + client.mjs.
//
// Usage:
//   node tests/digest.test.mjs [dir]
// Default dir is mod/ — that is the directory that gets installed, so it must
// contain nothing but mod.json + client.mjs + preview.png. The repository root
// legitimately holds tests/ and tools/; those must NOT be copied in.
//
// Skips (exit 0) when the host module is not extractable on this machine.
import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const modDir = path.resolve(here, '..', 'mod');
const dir = process.argv[2] || modDir;
console.log('digest dir:', dir);

if (!existsSync(dir)) {
  console.log('FAIL: 目录不存在');
  process.exit(1);
}

function findHostModule(fileName) {
  const bases = [];
  if (process.env.FOLIA_MODSYSTEM_DIR) {
    bases.push(process.env.FOLIA_MODSYSTEM_DIR, path.join(process.env.FOLIA_MODSYSTEM_DIR, 'electron', 'modSystem'));
  }
  bases.push(
    'C:/Other/Folia/resources/app.asar.unpacked/electron/modSystem',
    'C:/Other/Folia/resources/app.asar.unpacked/modSystem',
    'C:/Other/Folia/resources/app.asar.unpacked',
    path.join(os.homedir(), 'Documents', 'deepseek-harness', 'mod', '_folia_re', 'extracted', 'electron', 'modSystem'),
    path.join(os.homedir(), 'Documents', 'deepseek-harness', 'mod', '_folia_re', 'extracted')
  );
  for (const b of bases) {
    try {
      const p = path.join(b, fileName);
      if (existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

const digestPath = findHostModule('modDigest.cjs');
if (!digestPath) {
  console.log('SKIP: 找不到宿主自带的 modDigest.cjs。');
  console.log('      设置 FOLIA_MODSYSTEM_DIR 指向解包出的 electron/modSystem 目录即可启用本测试。');
  process.exit(0);
}
console.log('host digest module:', digestPath);

const require = createRequire(import.meta.url);
const digestMod = require(digestPath);
const fn =
  digestMod.computeModDigest ||
  digestMod.computeDigest ||
  digestMod.default ||
  Object.values(digestMod).find((v) => typeof v === 'function');
if (typeof fn !== 'function') {
  console.log('FAIL: 找不到摘要函数');
  process.exit(1);
}

const result = await fn(dir);
console.log('digest result:', JSON.stringify(result));
console.log('shortDigest:', digestMod.shortDigest ? digestMod.shortDigest(result) : '(n/a)');

/** Walk the tree the way the host does (it hashes every file, recursively). */
function walk(root, relative = '') {
  const dirPath = path.join(root, relative);
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  let files = [];
  for (const e of entries) {
    const rel = relative ? relative + '/' + e.name : e.name;
    if (e.isDirectory()) files = files.concat(walk(root, rel));
    else files.push(rel);
  }
  return files;
}

const installed = walk(dir);
console.log('files covered by the digest (' + installed.length + '):', installed.join(', '));

const limits = digestMod.DIGEST_LIMITS ?? { maxFiles: 2000, maxTotalBytes: 67108864 };
let total = 0;
for (const f of installed) {
  try {
    total += statSync(path.join(dir, f)).size;
  } catch {
    /* ignore */
  }
}
console.log('total bytes:', total, '(limit ' + limits.maxTotalBytes + ')');

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log('  PASS  ' + name);
  else {
    failures += 1;
    console.log('  FAIL  ' + name + (extra ? ' :: ' + extra : ''));
  }
}

const isInstallDir = path.basename(dir) === 'auto-skip' && /[\\/]mods[\\/]/.test(dir + path.sep);
if (isInstallDir || path.basename(dir) === 'mod') {
  // 提交目录可以带 LICENSE / README（官方社区模组都带），
  // 但入口与介绍图必须在，且不能混进 tests/ 之类的杂物。
  const required = ['mod.json', 'client.mjs', 'preview.png'];
  for (const f of required) {
    check('包含 ' + f, installed.indexOf(f) !== -1, installed.join(','));
  }
  const junk = installed.filter((f) => /^(tests|tools|variants)\//.test(f));
  check('没有混进 tests/ tools/ variants/', junk.length === 0, junk.join(','));
  if (isInstallDir) {
    check(
      '安装目录只含 mod.json、client.mjs、preview.png（摘要覆盖每个文件）',
      installed.slice().sort().join(',') === 'client.mjs,mod.json,preview.png',
      installed.join(',')
    );
  }
}
check('在文件数限制内', installed.length <= limits.maxFiles, installed.length + ' > ' + limits.maxFiles);
check('在总字节限制内', total <= limits.maxTotalBytes, total + ' > ' + limits.maxTotalBytes);
check('摘要已算出（未超限）', typeof result === 'string' && result.startsWith('sha256:'), String(result));

console.log(failures === 0 ? '\nDIGEST WITHIN LIMITS' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
