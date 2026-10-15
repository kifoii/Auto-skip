// 文案分类与按钮识别的单元测试（纯函数，不碰 DOM）。
//   node tests/texts.test.mjs
import { __internals } from '../client.mjs';
import activate from '../client.mjs';

const cases = [
  ['暂时无法播放这首歌', true],
  ['暂时无法播放这首歌，登录后可能可以播放', true],
  ["Can't play this song right now", true],
  ["Can't play this song right now. Signing in may help.", true],
  ["Can\u2019t play this song right now", true],
  ['Lagu ini belum dapat diputar saat ini', true],
  // 宿主自带倒计时：必须排除
  ['歌曲已下架，10 秒后自动跳过', false],
  ['播放出错，5 秒后自动跳过', false],
  ['Playback failed. Auto-skipping in 5s', false],
  // 其它错误：不动
  ['连接失败，无法获取这首歌，请检查网络后重试', false],
  ['歌曲已下架', false],
  ['', false],
];

let bad = 0;
for (const [text, want] of cases) {
  const got = __internals.isUnavailableText(text);
  const ok = got === want;
  if (!ok) bad += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  isUnavailableText(${JSON.stringify(text)}) = ${got} (want ${want})`);
}
console.log('skip label match:', __internals.isSkipLabel('跳过'), __internals.isSkipLabel('Skip'), __internals.isSkipLabel('Lewati'), __internals.isSkipLabel('重试'));
console.log('typeof default export:', typeof activate);
console.log(bad === 0 ? 'ALL MATCHER TESTS PASSED' : `${bad} FAILURES`);
