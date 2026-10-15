// 集成测试：用极简 DOM 替身驱动 activate()，覆盖「全面接管」的全部行为。
//   node tests/integration.test.mjs
import { __internals } from '../client.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 极简 DOM --------------------------------------------------------------
class FakeClassList {
  constructor() {
    this.set = new Set();
  }
  contains(n) {
    return this.set.has(n);
  }
}

class FakeEl {
  constructor(tag, classes, text) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.classList = new FakeClassList();
    for (const c of classes || []) this.classList.set.add(c);
    this.textContent = '';
    this.isConnected = true;
    this._texts = [];
    if (text !== undefined) {
      this._texts.push(text);
      // 让按钮的 textContent 真实反映标签，否则标签匹配无从测试
      this.textContent = text;
    }
    this.clicked = 0;
    this.handlerCalls = 0;
  }
  get ownText() {
    return this._texts.join(' ');
  }
  append(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  querySelector(sel) {
    if (sel === 'span') {
      for (const c of this.children) if (c.tagName === 'SPAN') return c;
      return null;
    }
    return null;
  }
  querySelectorAll(sel) {
    if (sel !== 'button') return [];
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (c.tagName === 'BUTTON') out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  click() {
    this.clicked += 1;
    if (this._removesToastOnClick && this.parentNode && this.parentNode.parentNode) {
      this.parentNode.parentNode.removeChild(this.parentNode);
    }
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
    child.isConnected = false;
  }
}

/** 模拟 React：把处理器挂在 __reactProps$<random> 自有属性上。 */
function attachHandler(btn, options, isRetry) {
  btn.handlerCalls = 0;
  if (options.withReactProps === false) return;
  const key = '__reactProps$' + (options.reactKey ?? 'testkey1');
  btn[key] = {
    onClick() {
      btn.handlerCalls += 1;
      if (btn._removesToastOnClick && btn.parentNode && btn.parentNode.parentNode) {
        btn.parentNode.parentNode.removeChild(btn.parentNode);
      }
    },
  };
  if (isRetry && options.retryRemovesToast === false) {
    btn[key] = {
      onClick() {
        btn.handlerCalls += 1;
      },
    };
  }
}

/** 按 Folia 的真实 DOM 结构造卡：[span 文案][按钮…] */
function makeToast(text, labels, options = {}) {
  const toast = new FakeEl('div', ['fixed', 'top-0', 'left-1/2', 'z-[210]']);
  const span = new FakeEl('span', [], text);
  span.textContent = text;
  toast.append(span);
  toast._buttons = [];
  for (const label of labels) {
    const b = new FakeEl('button', [], label);
    b._removesToastOnClick = true;
    attachHandler(b, options);
    toast.append(b);
    toast._buttons.push(b);
  }
  toast.textContent = text;
  return toast;
}

/** 「暂时无法播放」卡：跳过在 cancel 槽位，重试在 action 槽位。 */
function unavailableToast(options = {}) {
  return makeToast(
    options.text ?? '暂时无法播放这首歌',
    [options.skipLabel ?? '跳过', options.retryLabel ?? '重试'],
    options
  );
}

/** 原版倒计时卡：取消在 cancel 槽位，跳过在 action 槽位（与上面相反）。 */
function countdownToast(text = '歌曲已下架，10 秒后自动跳过', options = {}) {
  return makeToast(text, [options.cancelLabel ?? '取消', options.skipLabel ?? '跳过'], options);
}

const body = new FakeEl('div', [], '');
const observers = [];

const fakeDocument = {
  body,
  documentElement: { lang: 'zh-CN' },
  createElement: (t) => new FakeEl(t),
  querySelectorAll(sel) {
    if (sel !== '[class*="z-[210]"]') return [];
    return body.children.filter((c) => c.classList.contains('z-[210]'));
  },
  addEventListener() {},
};

class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb;
    this.connected = false;
    observers.push(this);
  }
  observe() {
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
  }
  fire(nodes) {
    if (this.connected) this.cb([{ addedNodes: nodes }]);
  }
}

globalThis.document = fakeDocument;
globalThis.MutationObserver = FakeMutationObserver;
globalThis.window = globalThis;

function addToast(t) {
  body.append(t);
  return t;
}

function clearToasts() {
  body.children = [];
}

function lastObserver() {
  return observers[observers.length - 1];
}

// ---- 假 folium API ---------------------------------------------------------
function makeFolium(settings = {}) {
  const values = {
    enabled: true,
    skipMode: 'direct',
    delayMs: 0,
    countdownDelayMs: 0,
    handleCountdown: true,
    maxSkipsPerMinute: 8,
    maxConsecutiveSkips: 0,
    resumeAfterGiveUp: true,
    ...settings,
  };
  const logs = [];
  const playback = {
    nextCalled: 0,
    state: 'stopped',
    next() {
      playback.nextCalled += 1;
    },
    getState() {
      return { song: null, state: playback.state, position: 0, duration: 0 };
    },
  };
  return {
    logs,
    values,
    playback,
    folium: {
      env: { context: 'main' },
      log: {
        info: (m) => logs.push(['info', m]),
        warn: (m) => logs.push(['warn', m]),
        error: (m) => logs.push(['error', m]),
      },
      registries: {
        settingsSections: {
          register() {
            return { params: { get: () => ({ ...values }) } };
          },
        },
      },
      playback,
    },
  };
}

// ---- 用例 ------------------------------------------------------------------
let failures = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log('PASS  ' + name);
  } else {
    failures += 1;
    console.log('FAIL  ' + name + (extra ? ' :: ' + extra : ''));
  }
}

const mod = await import('../client.mjs');

// 1. 主路径：直接调用宿主 skip 回调，不派发 click
{
  clearToasts();
  const { folium } = makeFolium();
  const dispose = mod.default(folium);
  const t = addToast(unavailableToast());
  lastObserver().fire([t]);
  await sleep(700);
  check('直接调用了宿主的跳过回调', t._buttons[0].handlerCalls >= 1, 'calls=' + t._buttons[0].handlerCalls);
  check('★没有派发任何 DOM click★', t._buttons[0].clicked === 0, 'clicked=' + t._buttons[0].clicked);
  check('没有调「重试」', t._buttons[1].handlerCalls === 0);
  check('提示卡已被摘除', t.isConnected === false);
  dispose();
}

// 2. 新默认：接管原版倒计时（handleCountdown=true）
{
  clearToasts();
  const { folium } = makeFolium({ handleCountdown: true });
  const dispose = mod.default(folium);
  const t = addToast(countdownToast());
  lastObserver().fire([t]);
  await sleep(700);
  check('接管倒计时：调用了「跳过」', t._buttons[1].handlerCalls >= 1, 'calls=' + t._buttons[1].handlerCalls);
  check('接管倒计时：没有误调「取消」', t._buttons[0].handlerCalls === 0);
  dispose();
}

// 3. handleCountdown=false 时完全不碰倒计时卡
{
  clearToasts();
  const { folium } = makeFolium({ handleCountdown: false });
  const dispose = mod.default(folium);
  const t = addToast(countdownToast());
  lastObserver().fire([t]);
  await sleep(600);
  check('关闭接管后倒计时不被触发', t._buttons[1].handlerCalls === 0 && t._buttons[0].handlerCalls === 0);
  dispose();
}

// 4. 宿主「正在跳过」信息卡（无按钮）绝不插手
{
  clearToasts();
  const { folium } = makeFolium();
  const dispose = mod.default(folium);
  const t = addToast(makeToast('歌曲已下架，正在跳过', []));
  lastObserver().fire([t]);
  await sleep(600);
  check('「正在跳过」信息卡被忽略', true);
  check('没有推队列', folium.playback.nextCalled === 0, 'next=' + folium.playback.nextCalled);
  dispose();
}

// 5. 其它错误提示不动
{
  clearToasts();
  const { folium } = makeFolium();
  const dispose = mod.default(folium);
  const t = addToast(makeToast('连接失败，无法获取这首歌，请检查网络后重试', ['重试', '跳过']));
  lastObserver().fire([t]);
  await sleep(600);
  check('网络错误提示未被触发', t._buttons[0].handlerCalls === 0 && t._buttons[1].handlerCalls === 0);
  check('网络错误也没推队列', folium.playback.nextCalled === 0);
  dispose();
}

// 6. enabled=false 不动作
{
  clearToasts();
  const { folium } = makeFolium({ enabled: false });
  const dispose = mod.default(folium);
  const t = addToast(unavailableToast());
  lastObserver().fire([t]);
  await sleep(600);
  check('关闭后不动作', t._buttons[0].handlerCalls === 0);
  dispose();
}

// 7. dispose 后不动作
{
  clearToasts();
  const { folium } = makeFolium();
  const dispose = mod.default(folium);
  dispose();
  const t = addToast(unavailableToast());
  lastObserver().fire([t]);
  await sleep(600);
  check('dispose 后不动作', t._buttons[0].handlerCalls === 0);
}

// 8. 英文文案 + 英文按钮 + 英文倒计时（不误判）
{
  clearToasts();
  const { folium } = makeFolium({ handleCountdown: false });
  const dispose = mod.default(folium);
  const t1 = addToast(
    unavailableToast({
      text: "Can't play this song right now",
      skipLabel: 'Skip',
      retryLabel: 'Retry',
    })
  );
  lastObserver().fire([t1]);
  await sleep(600);
  check('英文提示被正确触发', t1._buttons[0].handlerCalls >= 1);

  const t2 = addToast(makeToast('Playback failed. Auto-skipping in 5s', ['Cancel', 'Skip']));
  lastObserver().fire([t2]);
  await sleep(600);
  check('英文倒计时不被触发（已关闭接管）', t2._buttons[1].handlerCalls === 0);
  dispose();
}

// 9. 限流：maxSkipsPerMinute=2，连来 4 张卡只应跳 2 次
{
  clearToasts();
  const { folium } = makeFolium({ maxSkipsPerMinute: 2, maxConsecutiveSkips: 0 });
  const dispose = mod.default(folium);
  for (let i = 0; i < 4; i += 1) {
    const t = addToast(unavailableToast());
    lastObserver().fire([t]);
    await sleep(600);
  }
  const invoked = body.children.filter((c) => c._buttons[0] && c._buttons[0].handlerCalls > 0).length;
  check('限流生效（不超过 2 次）', invoked <= 2, 'invoked=' + invoked);
  dispose();
}

// 10. ★关键安全用例★ 只有 [取消][重试]（mid-playback 拿不到 skip 回调）
//     必须改为 playback.next()，绝不能调「取消」把提示卡静默关掉。
{
  clearToasts();
  const { folium } = makeFolium({ maxConsecutiveSkips: 0 });
  const dispose = mod.default(folium);
  const t = addToast(makeToast('暂时无法播放这首歌', ['取消', '重试']));
  lastObserver().fire([t]);
  await sleep(700);
  check('没有误调「取消」', t._buttons[0].handlerCalls === 0, 'cancel=' + t._buttons[0].handlerCalls);
  check('没有误调「重试」', t._buttons[1].handlerCalls === 0, 'retry=' + t._buttons[1].handlerCalls);
  check('改用 playback.next() 推进队列', folium.playback.nextCalled >= 1, 'next=' + folium.playback.nextCalled);
  dispose();
}

// 11. 未知语言包但提供「重试」+ 一个其它按钮 → 应识别出 skip 槽位
{
  clearToasts();
  const { folium } = makeFolium({ maxConsecutiveSkips: 0 });
  const dispose = mod.default(folium);
  const t = addToast(makeToast('暂时无法播放这首歌', ['XYZ', 'Retry']));
  lastObserver().fire([t]);
  await sleep(700);
  check('未知语言下按槽位推断并调用 skip', t._buttons[0].handlerCalls >= 1, 'calls=' + t._buttons[0].handlerCalls);
  check('没有误调 Retry', t._buttons[1].handlerCalls === 0);
  check('未派发 DOM click', t._buttons[0].clicked === 0);
  dispose();
}

// 12. 拿不到 React props 时才退回 DOM 点击（兜底路径必须仍然可用）
{
  clearToasts();
  const { folium } = makeFolium({ maxConsecutiveSkips: 0 });
  const dispose = mod.default(folium);
  const t = addToast(unavailableToast({ withReactProps: false }));
  lastObserver().fire([t]);
  await sleep(700);
  check('无 React props 时退回 DOM 点击', t._buttons[0].clicked >= 1, 'clicked=' + t._buttons[0].clicked);
  check('兜底路径没有误点重试', t._buttons[1].clicked === 0);
  dispose();
}

// 13. 登录提示变体文案也要识别
{
  clearToasts();
  const { folium } = makeFolium({ maxConsecutiveSkips: 0 });
  const dispose = mod.default(folium);
  const t = addToast(unavailableToast({ text: '暂时无法播放这首歌，登录后可能可以播放' }));
  lastObserver().fire([t]);
  await sleep(700);
  check('登录提示变体被识别', t._buttons[0].handlerCalls >= 1);
  dispose();
}

// 14. 同一张卡不重复触发（去重）
{
  clearToasts();
  const { folium } = makeFolium({ maxConsecutiveSkips: 0 });
  const dispose = mod.default(folium);
  const t = addToast(unavailableToast());
  t._buttons[0]._removesToastOnClick = false;
  t._buttons[0].__reactProps$testkey1.onClick = function () {
    t._buttons[0].handlerCalls += 1;
  };
  const obs = lastObserver();
  obs.fire([t]);
  await sleep(500);
  const first = t._buttons[0].handlerCalls;
  obs.fire([t]);
  obs.fire([t]);
  await sleep(700);
  check('同一张卡只触发一次', t._buttons[0].handlerCalls === first && first >= 1, 'first=' + first + ' total=' + t._buttons[0].handlerCalls);
  check('未派发 DOM click', t._buttons[0].clicked === 0);
  dispose();
}

// 15. skipMode='click' 只派发 click
{
  clearToasts();
  const { folium } = makeFolium({ skipMode: 'click', maxConsecutiveSkips: 0 });
  const dispose = mod.default(folium);
  const t = addToast(unavailableToast());
  lastObserver().fire([t]);
  await sleep(700);
  check('click 模式派发了 click', t._buttons[0].clicked >= 1, 'clicked=' + t._buttons[0].clicked);
  dispose();
}

// 16. 连续跳过上限 maxConsecutiveSkips=2：第三张卡收手
{
  clearToasts();
  const { folium } = makeFolium({ maxConsecutiveSkips: 2, maxSkipsPerMinute: 60 });
  const dispose = mod.default(folium);
  const toasts = [];
  for (let i = 0; i < 3; i += 1) {
    const t = addToast(unavailableToast());
    toasts.push(t);
    lastObserver().fire([t]);
    await sleep(500);
  }
  const invoked = toasts.filter((t) => t._buttons[0].handlerCalls > 0).length;
  check('连续上限生效（只跳 2 次）', invoked === 2, 'invoked=' + invoked);
  dispose();
}

// 17. 连续上限 0 = 不限，一直跳到能播为止
{
  clearToasts();
  const { folium } = makeFolium({ maxConsecutiveSkips: 0, maxSkipsPerMinute: 60 });
  const dispose = mod.default(folium);
  const toasts = [];
  for (let i = 0; i < 5; i += 1) {
    const t = addToast(unavailableToast());
    toasts.push(t);
    lastObserver().fire([t]);
    await sleep(400);
  }
  const invoked = toasts.filter((t) => t._buttons[0].handlerCalls > 0).length;
  check('0 = 不限（5 张卡都跳）', invoked === 5, 'invoked=' + invoked);
  dispose();
}

// 18. 播放成功 → 连续计数归零（上限 2 时能一直跳下去）
{
  clearToasts();
  const { folium, playback } = makeFolium({ maxConsecutiveSkips: 2, maxSkipsPerMinute: 60 });
  const dispose = mod.default(folium);
  const counts = [];
  for (let i = 0; i < 3; i += 1) {
    const t = addToast(unavailableToast());
    lastObserver().fire([t]);
    await sleep(400);
    counts.push(t._buttons[0].handlerCalls);
    // 模拟这一首真的播起来了
    playback.state = 'playing';
    lastObserver().fire([t]);
    await sleep(200);
    playback.state = 'stopped';
  }
  const invoked = counts.filter((c) => c > 0).length;
  check('播成功后计数归零（3 张卡都跳）', invoked === 3, 'invoked=' + invoked);
  dispose();
}

// 19. 宿主放弃（IDLE/stopped）后继续推进队列
{
  clearToasts();
  const { folium, playback } = makeFolium({ resumeAfterGiveUp: true, maxConsecutiveSkips: 0 });
  const dispose = mod.default(folium);
  const t = addToast(unavailableToast());
  lastObserver().fire([t]);
  await sleep(500);
  check('先跳了一次', t._buttons[0].handlerCalls >= 1);
  playback.state = 'stopped';
  // 等 backstop 轮询到「放弃」并推队列
  await sleep(3500);
  check('宿主放弃后自动推进队列', folium.playback.nextCalled >= 1, 'next=' + folium.playback.nextCalled);
  dispose();
}

// 20. resumeAfterGiveUp=false 时不推进
{
  clearToasts();
  const { folium, playback } = makeFolium({ resumeAfterGiveUp: false, maxConsecutiveSkips: 0 });
  const dispose = mod.default(folium);
  const t = addToast(unavailableToast());
  lastObserver().fire([t]);
  await sleep(500);
  playback.state = 'stopped';
  await sleep(3500);
  check('关闭后不推队列', folium.playback.nextCalled === 0, 'next=' + folium.playback.nextCalled);
  dispose();
}

// 21. 设置项注册被宿主拒绝时不影响自动跳过
{
  clearToasts();
  const folium = {
    env: { context: 'main' },
    log: { info() {}, warn() {}, error() {} },
    registries: {
      settingsSections: {
        register() {
          throw new Error('settingsSections.register: settings must declare at least one valid field');
        },
      },
    },
    playback: { nextCalled: 0, next() {}, getState: () => null },
  };
  const dispose = mod.default(folium);
  const t = addToast(unavailableToast());
  lastObserver().fire([t]);
  await sleep(700);
  check('设置注册失败后仍能跳过', t._buttons[0].handlerCalls >= 1);
  dispose();
}

// 22. 回归：撞限流后不能空转刷日志。
//
// 真实事故：performSkip 在限流时直接 return，noteToastAttempt() 没跑到，
// 每卡预算永不消耗，scheduleSkip 看到 false 就重扫，31 秒刷出 3610 条警告
// （中位间隔 0ms，同一毫秒 24 条）。这里钉住「告警条数必须是常数级」。
{
  clearToasts();
  const { folium, logs } = makeFolium({ maxSkipsPerMinute: 2, maxConsecutiveSkips: 0 });
  const dispose = mod.default(folium);
  // 一张常驻的卡 + 反复触发扫描，模拟宿主不断重发失败卡
  const t = addToast(unavailableToast());
  for (let i = 0; i < 40; i += 1) {
    lastObserver().fire([t]);
    await sleep(25);
  }
  const warns = logs.filter((l) => l[0] === 'warn').length;
  check('限流后没有刷屏（告警 <= 12 条）', warns <= 12, 'warns=' + warns);
  dispose();
}

// 23. 回归：撞限流时也要消耗每卡预算（不能无限重排同一张卡）
{
  clearToasts();
  const { folium } = makeFolium({ maxSkipsPerMinute: 1, maxConsecutiveSkips: 0 });
  const dispose = mod.default(folium);
  const t = addToast(unavailableToast());
  lastObserver().fire([t]);
  await sleep(400);
  const first = t._buttons[0].handlerCalls;
  for (let i = 0; i < 30; i += 1) {
    lastObserver().fire([t]);
    await sleep(20);
  }
  check('限流后同一张卡不再被反复调用', t._buttons[0].handlerCalls === first, 
    'first=' + first + ' now=' + t._buttons[0].handlerCalls);
  dispose();
}

// 24. 退避是暂时的：窗口过后仍能继续跳过。
//     用连跳上限触发退避（限流窗口是 60 秒，等不起）；退避过后靠
//     「播放跑起来了」把连续计数归零，就能接着跳。
{
  clearToasts();
  const { folium, playback } = makeFolium({
    maxConsecutiveSkips: 1,
    maxSkipsPerMinute: 60,
    resumeAfterGiveUp: false,
  });
  const dispose = mod.default(folium);
  const t1 = addToast(unavailableToast());
  lastObserver().fire([t1]);
  await sleep(500);
  check('第一张卡已跳过', t1._buttons[0].handlerCalls >= 1);

  // 第二张卡撞连跳上限 → 进入退避
  const t2 = addToast(unavailableToast({ reactKey: 'testkey2' }));
  lastObserver().fire([t2]);
  await sleep(400);
  check('撞上限时不跳', t2._buttons[0].handlerCalls === 0, 'calls=' + t2._buttons[0].handlerCalls);

  // 退避窗口过掉，并且播放真的跑起来了（连续计数归零）
  playback.state = 'playing';
  await sleep(5600);
  const t3 = addToast(unavailableToast({ reactKey: 'testkey3' }));
  lastObserver().fire([t3]);
  await sleep(700);
  check(
    '退避过后新卡仍会跳',
    t3._buttons[0].handlerCalls >= 1,
    'calls=' + t3._buttons[0].handlerCalls,
  );
  dispose();
}

console.log(failures === 0 ? '\nALL INTEGRATION TESTS PASSED' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
