// 变体测试：client.mjs 与两个单策略锁定变体的行为必须各自符合预期。
//   node tests/variants.test.mjs

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 极简 DOM --------------------------------------------------------------
class FakeClassList {
  constructor() { this.set = new Set(); }
  contains(n) { return this.set.has(n); }
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
    this._texts = text !== undefined ? [text] : [];
    if (text !== undefined) this.textContent = text;
    this.clicked = 0;
    this.handlerCalls = 0;
  }
  get ownText() { return this._texts.join(' '); }
  append(c) { c.parentNode = this; this.children.push(c); return c; }
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
    const walk = (n) => { for (const c of n.children) { if (c.tagName === 'BUTTON') out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  click() {
    this.clicked += 1;
    if (this._removesToastOnClick && this.parentNode && this.parentNode.parentNode) {
      this.parentNode.parentNode.removeChild(this.parentNode);
    }
  }
  removeChild(c) {
    this.children = this.children.filter((x) => x !== c);
    c.parentNode = null;
    c.isConnected = false;
  }
}

function attachHandler(btn, withProps) {
  if (!withProps) return;
  const key = '__reactProps$variantkey';
  btn[key] = {
    onClick() {
      btn.handlerCalls += 1;
      if (btn._removesToastOnClick && btn.parentNode && btn.parentNode.parentNode) {
        btn.parentNode.parentNode.removeChild(btn.parentNode);
      }
    },
  };
}

function makeToast(text, labels, withProps) {
  const toast = new FakeEl('div', ['fixed', 'top-0', 'left-1/2', 'z-[210]']);
  const span = new FakeEl('span', [], text);
  span.textContent = text;
  toast.append(span);
  toast._buttons = [];
  for (const label of labels) {
    const b = new FakeEl('button', [], label);
    b._removesToastOnClick = true;
    attachHandler(b, withProps);
    toast.append(b);
    toast._buttons.push(b);
  }
  toast.textContent = text;
  return toast;
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
  constructor(cb) { this.cb = cb; this.connected = false; observers.push(this); }
  observe() { this.connected = true; }
  disconnect() { this.connected = false; }
  fire(nodes) { if (this.connected) this.cb([{ addedNodes: nodes }]); }
}

globalThis.document = fakeDocument;
globalThis.MutationObserver = FakeMutationObserver;
globalThis.window = globalThis;

function makeFolium(settings = {}) {
  const values = { enabled: true, delayMs: 0, maxSkipsPerMinute: 8, ...settings };
  return {
    env: { context: 'main' },
    log: { info() {}, warn() {}, error() {} },
    registries: {
      settingsSections: { register: () => ({ params: { get: () => ({ ...values }) } }) },
    },
    playback: { nextCalled: 0, next() { this.nextCalled += 1; } },
  };
}

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log('  PASS  ' + name);
  else { failures += 1; console.log('  FAIL  ' + name + (extra ? ' :: ' + extra : '')); }
}

async function runFile(label, mod, expect) {
  console.log('\n=== ' + label + ' ===');
  const last = () => observers[observers.length - 1];

  // A. 主路径：识别文案并跳过
  body.children = [];
  {
    const folium = makeFolium({ delayMs: 0 });
    const dispose = mod.default(folium);
    const t = makeToast('暂时无法播放这首歌', ['跳过', '重试'], true);
    body.append(t);
    last().fire([t]);
    await sleep(600);
    if (expect === 'click') {
      check('派发了 click', t._buttons[0].clicked >= 1, 'clicked=' + t._buttons[0].clicked);
      check('没有碰 React props', t._buttons[0].handlerCalls === 0, 'calls=' + t._buttons[0].handlerCalls);
    } else {
      check('调用了 React 回调', t._buttons[0].handlerCalls >= 1, 'calls=' + t._buttons[0].handlerCalls);
      check('没有派发 click', t._buttons[0].clicked === 0, 'clicked=' + t._buttons[0].clicked);
    }
    check('未误动「重试」', t._buttons[1].clicked === 0 && t._buttons[1].handlerCalls === 0);
    dispose();
  }

  // B. 倒计时提示：默认接管（全面接管），关掉 handleCountdown 后不能抢
  body.children = [];
  {
    const folium = makeFolium({ handleCountdown: false });
    const dispose = mod.default(folium);
    const t = makeToast('歌曲已下架，10 秒后自动跳过', ['取消', '跳过'], true);
    body.append(t);
    last().fire([t]);
    await sleep(500);
    check('handleCountdown=false 时倒计时提示未被触发',
      t._buttons[0].clicked === 0 && t._buttons[0].handlerCalls === 0 &&
      t._buttons[1].clicked === 0 && t._buttons[1].handlerCalls === 0);
    dispose();
  }
  body.children = [];
  {
    const folium = makeFolium({ handleCountdown: true, countdownDelayMs: 0, delayMs: 0 });
    const dispose = mod.default(folium);
    const t = makeToast('歌曲已下架，10 秒后自动跳过', ['取消', '跳过'], true);
    body.append(t);
    last().fire([t]);
    await sleep(600);
    const skipBtn = t._buttons[1];
    check('handleCountdown=true 时接管倒计时（跳过被触发）',
      expect === 'click' ? skipBtn.clicked >= 1 : skipBtn.handlerCalls >= 1,
      'clicked=' + skipBtn.clicked + ' calls=' + skipBtn.handlerCalls);
    check('接管倒计时时未误动「取消」',
      t._buttons[0].clicked === 0 && t._buttons[0].handlerCalls === 0);
    dispose();
  }

  // C. 无「跳过」槽位时改走 playback.next()
  body.children = [];
  {
    const folium = makeFolium({ delayMs: 0 });
    const dispose = mod.default(folium);
    const t = makeToast('暂时无法播放这首歌', ['取消', '重试'], true);
    body.append(t);
    last().fire([t]);
    await sleep(600);
    check('未误动「取消」', t._buttons[0].clicked === 0 && t._buttons[0].handlerCalls === 0);
    check('改走 playback.next()', folium.playback.nextCalled >= 1, 'next=' + folium.playback.nextCalled);
    dispose();
  }
}

const dual = await import('../client.mjs');
const directOnly = await import('../variants/client.direct-only.mjs');
const clickOnly = await import('../variants/client.click-only.mjs');

await runFile('client.mjs  (默认 direct)', dual, 'direct');
await runFile('variants/client.direct-only.mjs', directOnly, 'direct');
await runFile('variants/client.click-only.mjs', clickOnly, 'click');

console.log(failures === 0 ? '\nALL VARIANT TESTS PASSED' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
