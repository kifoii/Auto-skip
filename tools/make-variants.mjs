/**
 * 从 client.mjs 生成两个变体文件。
 *
 * 变体 = 把 skipMode 钉死成某一种，其余完全一样。
 * 之所以用脚本生成而不是手改：手改的两份副本会随 client.mjs 演进慢慢分叉，
 * 以前就这么烂过一次 —— 变体停在 1.1.0，主文件已经到 1.2.0。
 *
 *   node tools/make-variants.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'client.mjs');

/** 源文件里这一行就是「让设置项决定 skipMode」的地方，变体把它换成固定值。 */
const MODE_ASSIGN = "      if (v.skipMode === 'direct' || v.skipMode === 'click') out.skipMode = v.skipMode;";
/** DEFAULT_SETTINGS 里的默认值行。 */
const MODE_DEFAULT = "  skipMode: 'direct',";

const HEADER = (mode) =>
  `// ⚠️ 变体文件（非安装用）：固定 skipMode = '${mode}'\n` +
  '// 安装的是 client.mjs（可在设置里切换方式）。\n' +
  '// 换用本变体需要把它改名成 client.mjs 覆盖过去，并重新批准一次。\n\n';

/** 按空格缩进原样替换一行，找不到就报错而不是静默产出坏文件。 */
function replaceLine(text, needle, replacement, what) {
  if (text.indexOf(needle) === -1) {
    throw new Error(`make-variants: 在 client.mjs 里找不到${what}，源文件结构变了：\n  ${needle}`);
  }
  if (text.split(needle).length !== 2) {
    throw new Error(`make-variants: ${what} 匹配到多处，无法确定改哪一处：\n  ${needle}`);
  }
  return text.replace(needle, replacement);
}

const source = await readFile(SRC, 'utf8');

for (const mode of ['direct', 'click']) {
  const other = mode === 'direct' ? 'click' : 'direct';
  let out = source;

  out = replaceLine(
    out,
    MODE_DEFAULT,
    `  skipMode: '${mode}',`,
    'DEFAULT_SETTINGS.skipMode',
  );
  out = replaceLine(
    out,
    MODE_ASSIGN,
    `      // 本变体固定为 ${mode}，忽略设置项里的选择`,
    'readSettings 里的 skipMode 赋值',
  );

  // 变体不该再提「可以改成另一种」——它已经钉死了。
  out = out.replace(
    new RegExp(`\\* （skipMode:'${other}'[^\\n]*\\n`),
    `* 本变体固定为 '${mode}'，另一种方式见另一个变体文件。\n`,
  );

  const dest = join(root, 'variants', `client.${mode}-only.mjs`);
  await writeFile(dest, HEADER(mode) + out, 'utf8');
  console.log(`wrote variants/client.${mode}-only.mjs`);
}
