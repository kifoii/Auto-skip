// 用官方仓库的真实 CI 校验器在本地预演提交，免得表单填完才发现格式不过。
//   node tools/ci-dryrun.mjs
//
// 官方校验器不随本仓库分发（那些是 folium-compound 自己的代码，混进提交目录
// 会被一起收走）。脚本按顺序在下面几个位置找 folium-compound 的只读副本，
// 找不到就 SKIP —— 本仓库要能在没克隆过官方仓库的机器上照常跑测试。
//
//   node tools/ci-dryrun.mjs
//   FOLIUM_COMPOUND_DIR=/path/to/folium-compound node tools/ci-dryrun.mjs
//
// 它会：① 按 source.mjs 的规则把「提交目录」暂存一份（去掉点开头项与 node_modules）；
// ② 用 checkModTree 跑格式检查；③ 打印会出现在 issue 里的文件清单与签名摘要。
//
// 提交目录是仓库里的 mod/（表单的「模组目录」填 mod）。CI 会用
// <repo>@<ref> 下的这个目录当模组根，所以这里也照做。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
/** 提交目录相对仓库根的位置；表单里的「模组目录」要填这个。 */
const SUBMISSION_PATH = 'mod';
const sourceDir = path.join(repoRoot, SUBMISSION_PATH);

/** CI 里 mods/community 下已有的 id；用于检测撞名与「依赖不在仓库里」的警告。 */
const KNOWN_MOD_IDS = [
    'bilingual-ruby-lyrics',
    'cinerama',
    'enhanced-remote-widget',
    'lx-favorites-sync',
    'lyric-ai-director',
    'lyric-split-translation',
    'lyrics-list',
    'spectrum-visualizer',
];

/** 官方仓库只读副本的候选位置。 */
function compoundCandidates() {
    const out = [];
    if (process.env.FOLIUM_COMPOUND_DIR) out.push(process.env.FOLIUM_COMPOUND_DIR);
    out.push(path.join(os.tmpdir(), 'folium-compound-ro'));
    out.push(path.join(os.tmpdir(), 'folium-compound'));
    return out;
}

function findCompound() {
    for (const dir of compoundCandidates()) {
        if (fs.existsSync(path.join(dir, 'tools', 'ci', 'lib', 'submission.mjs'))) return dir;
        // 允许直接指向 tools/ 或仓库内任意层级
        const alt = path.join(dir, 'ci', 'lib', 'submission.mjs');
        if (fs.existsSync(alt)) return path.dirname(path.dirname(dir));
    }
    return null;
}

const compound = findCompound();
if (!compound) {
    console.log('SKIP: 找不到 folium-compound 的只读副本，跳过 CI 预演。');
    console.log('      克隆一份官方仓库，或用 FOLIUM_COMPOUND_DIR 指向它：');
    console.log('      git clone --depth 1 https://github.com/chthollyphile/folium-compound %TEMP%\\folium-compound-ro');
    process.exit(0);
}
console.log('官方校验器来源:', compound);

const { checkModTree, COMMUNITY_LIMITS } = await import(
    pathToFileURL(path.join(compound, 'tools', 'ci', 'lib', 'submission.mjs')).href
);
const { collectSignedFiles, computeSignedDigest, SIGNATURE_FILE } = await import(
    pathToFileURL(path.join(compound, 'tools', 'lib', 'signing.mjs')).href
);

// source.mjs：只暂存模组目录，去掉以 . 开头的项和 node_modules
const stage = (source, dest) => {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const name = entry.name;
        if (name.startsWith('.') || name === 'node_modules') continue;
        const from = path.join(source, name);
        const to = path.join(dest, name);
        if (entry.isDirectory()) stage(from, to);
        else if (entry.isFile()) fs.copyFileSync(from, to);
    }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-skip-ci-'));
const modDir = path.join(tmp, 'auto-skip');
stage(sourceDir, modDir);

const manifest = JSON.parse(fs.readFileSync(path.join(modDir, 'mod.json'), 'utf8'));

console.log(`\n=== 提交目录（仓库 ${SUBMISSION_PATH}/ → CI 收录的文件）===`);
const files = collectSignedFiles(modDir);
for (const file of files) {
    const size = fs.statSync(file.absolute).size;
    console.log(`  ${file.relative.padEnd(34)} ${String(size).padStart(8)} B`);
}
const totalBytes = files.reduce((sum, f) => sum + fs.statSync(f.absolute).size, 0);
console.log(`  小计 ${files.length} 个文件 / ${totalBytes} 字节` +
    `  (上限 ${COMMUNITY_LIMITS.maxFiles} 个 / ${COMMUNITY_LIMITS.maxTotalBytes} 字节)`);
console.log(`  签名摘要 ${computeSignedDigest(modDir).digest}`);

console.log('\n=== checkModTree（官方 CI 的判定）===');
const result = checkModTree({ modDir, modId: manifest.id, existing: null, knownModIds: KNOWN_MOD_IDS });
console.log(`  errors  : ${result.errors.length}`);
result.errors.forEach((e) => console.log(`    ✗ ${e}`));
console.log(`  warnings: ${result.warnings.length}`);
result.warnings.forEach((w) => console.log(`    ! ${w}`));
console.log(`  mod.json ok: ${result.manifest !== null}`);
console.log(`  ${SIGNATURE_FILE} 不存在: ${!fs.existsSync(path.join(modDir, SIGNATURE_FILE))}`);

if (result.errors.length === 0) {
    console.log('\n结论：CI 格式检查通过。');
} else {
    console.log('\n结论：CI 会拒绝本次提交（见上面的 ✗）。');
    process.exitCode = 1;
}

fs.rmSync(tmp, { recursive: true, force: true });
