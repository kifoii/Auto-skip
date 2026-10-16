// 纯函数单元测试（不碰 DOM、不需要宿主）。
//   node tests/texts.test.mjs
import { __internals } from '../mod/client.mjs';
import activate from '../mod/client.mjs';

const { normalizeText, songKey, detectLocale, DEFAULT_SETTINGS, UNPLAYABLE_REASONS, AUTH_NETWORK_REASONS } =
  __internals;

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} = ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
}

/* normalizeText */
check('normalizeText 折叠空白', normalizeText('  a \n b  '), 'a b');
check('normalizeText 非字符串', normalizeText(null), '');

/* songKey：ref > id > 标题+歌手 */
check('songKey 优先 ref', songKey({ ref: 'r1', id: 5, title: 'T' }), 'r:r1');
check('songKey 退回 id', songKey({ ref: null, id: 5, title: 'T' }), 'i:5');
check('songKey 退回标题', songKey({ ref: null, id: null, title: ' T ', artist: ' A ' }), 't:T|A');
check('songKey 空对象', songKey({}), '');
check('songKey null', songKey(null), '');

/* detectLocale 的取值域 */
const loc = detectLocale();
check('detectLocale 落在三语之内', ['zh-CN', 'en', 'id'].indexOf(loc) !== -1, true);

/* 默认值必须落在 schema 允许的范围内 */
check('默认值 enabled', DEFAULT_SETTINGS.enabled, true);
check('默认值 skipUnplayable', DEFAULT_SETTINGS.skipUnplayable, true);
check('默认值 skipAuthNetwork 为关', DEFAULT_SETTINGS.skipAuthNetwork, false);
check(
  '默认连续跳过上限不为 0（不绕过宿主上限）',
  DEFAULT_SETTINGS.maxConsecutiveSkips > 0 && DEFAULT_SETTINGS.maxConsecutiveSkips <= 5,
  true
);
check('默认 delayMs 在 0-5000', DEFAULT_SETTINGS.delayMs >= 0 && DEFAULT_SETTINGS.delayMs <= 5000, true);

/* reason 分类：两批不许重叠，且必须是宿主公开枚举 */
const overlap = UNPLAYABLE_REASONS.filter((r) => AUTH_NETWORK_REASONS.indexOf(r) !== -1);
check('两批 reason 不重叠', overlap, []);
check(
  'reason 全部在公开枚举内',
  UNPLAYABLE_REASONS.concat(AUTH_NETWORK_REASONS).every(
    (r) => ['auth', 'restricted', 'taken-down', 'network', 'unknown'].indexOf(r) !== -1
  ),
  true
);

console.log('typeof default export:', typeof activate);
console.log(bad === 0 ? 'ALL MATCHER TESTS PASSED' : `${bad} FAILURES`);
process.exit(bad === 0 ? 0 : 1);
