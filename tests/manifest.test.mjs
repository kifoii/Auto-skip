// Validate mod.json with Folia's OWN manifest validator (electron/modSystem/manifest.cjs).
//
// That file lives inside Folia's app.asar, so it must be available as a plain
// file. Point FOLIA_MODSYSTEM_DIR at a directory containing the extracted
// modSystem modules, or let the script try the usual locations. When the host
// module cannot be found the test SKIPS (exit 0) instead of failing — the
// repository must stay runnable on a machine without Folia.
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const modDir = path.resolve(here, '..');

/** Candidate directories that may hold the extracted modSystem/ modules. */
function candidates() {
  const out = [];
  const env = process.env.FOLIA_MODSYSTEM_DIR;
  if (env) {
    // Accept either the modSystem dir itself or its parent.
    out.push(env, path.join(env, 'electron', 'modSystem'));
  }
  for (const base of [
    'C:/Other/Folia/resources/app.asar.unpacked',
    path.join(os.homedir(), 'Documents', 'deepseek-harness', 'mod', '_folia_re', 'extracted'),
  ]) {
    out.push(
      path.join(base, 'electron', 'modSystem'),
      path.join(base, 'modSystem'),
      base
    );
  }
  return out;
}

function findHostModule(fileName) {
  for (const dir of candidates()) {
    try {
      const p = path.join(dir, fileName);
      if (existsSync(p)) return p;
    } catch {
      /* ignore unreadable candidates */
    }
  }
  return null;
}

const manifestPath = findHostModule('manifest.cjs');
if (!manifestPath) {
  console.log('SKIP: 找不到宿主自带的 manifest.cjs。');
  console.log('      设置 FOLIA_MODSYSTEM_DIR 指向解包出的 electron/modSystem 目录即可启用本测试。');
  process.exit(0);
}
console.log('host validator:', manifestPath);

const require = createRequire(import.meta.url);
const m = require(manifestPath);

const raw = JSON.parse(readFileSync(path.join(modDir, 'mod.json'), 'utf8'));
const res = m.validateManifest(raw, { dirPath: modDir, source: 'user' });

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log('  PASS  ' + name);
  else {
    failures += 1;
    console.log('  FAIL  ' + name + (extra ? ' :: ' + extra : ''));
  }
}

console.log('validateManifest ok:', res.ok);
if (!res.ok) {
  console.log('errors:', JSON.stringify(res.errors ?? res, null, 2));
  process.exit(1);
}
const man = res.value ?? res.manifest ?? res;
console.log('id:', man.id, '| version:', man.version, '| client:', man.client, '| main:', man.main ?? '(none)');

check('id 合法且为预期值', man.id === 'auto-skip', man.id);
check('name 为 Auto skip', man.name === 'Auto skip', man.name);
check('client 文件真实存在', existsSync(path.join(modDir, man.client)));
check('声明了 folium 1', man.folium === 1, String(man.folium));
for (const p of man.permissions ?? []) {
  check(`permission "${p}" 是宿主已知权限`, m.KNOWN_PERMISSIONS.has(p));
}
// 1.2.0 起底部是 0.7.20：playback.failed 事件与原生开关都是这一版才有的。
check('host range 满足 0.7.20', m.satisfiesHostRange('0.7.20', man.folia) === true);
check('host range 排除过旧的 0.7.19', m.satisfiesHostRange('0.7.19', man.folia) === false);

const plan = m.resolveLoadPlan(new Map([[man.id, man]]), {
  roots: [man.id],
  source: 'user',
  isEnabled: () => true,
});
check('依赖图无失败节点', Object.keys(plan.failures ?? {}).length === 0, JSON.stringify(plan.failures));
check('加载顺序包含本模组', plan.order.includes(man.id), JSON.stringify(plan.order));

// 安装目录里只应该有 mod.json 与 client.mjs —— 宿主摘要覆盖目录下每一个文件。
const stray = readdirSync(modDir).filter(
  (n) => n !== 'mod.json' && n !== 'client.mjs' && !n.startsWith('.')
);
console.log('（本仓库根目录还包含以下内容，安装时不要拷进 mods 目录：' + stray.join(', ') + '）');

console.log(failures === 0 ? '\nMANIFEST VALIDATION PASSED' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
