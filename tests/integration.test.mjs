// 集成测试：用假宿主驱动 activate()，覆盖 1.4.0 事件驱动的全部行为。
//   node tests/integration.test.mjs
//
// 1.4.0 起本模组不碰宿主 DOM，所以这个测试里没有 DOM 替身：
// 只发 playback.failed / songChanged / stateChanged 事件，看 playback.next() 的调用。
import activate from '../mod/client.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- 假宿主 -------------------------------------------------------------- */

/** 造一个假 folium，记录事件处理器、日志与 next() 调用。 */
function makeFolium(settings = {}, options = {}) {
  const values = {
    enabled: true,
    skipUnplayable: true,
    skipAuthNetwork: false,
    delayMs: 0,
    maxSkipsPerMinute: 8,
    maxConsecutiveSkips: 3,
    ...settings,
  };
  const handlers = new Map();
  const logs = [];
  const playback = {
    nextCalls: 0,
    song: options.song ?? { ref: 'song-1', id: '1', title: 'A', artist: 'B' },
    state: 'stopped',
    next() {
      playback.nextCalls += 1;
    },
    getState() {
      return {
        song: playback.song,
        state: playback.state,
        position: 0,
        duration: 0,
      };
    },
  };
  const folium = {
    env: { context: 'main' },
    host: { folia: '0.7.20', folium: { major: 1, minor: options.minor ?? 5 } },
    manifest: { permissions: ['playback.control'] },
    log: {
      info: (m) => logs.push(['info', m]),
      warn: (m) => logs.push(['warn', m]),
      error: (m) => logs.push(['error', m]),
    },
    registries: {
      settingsSections: {
        register() {
          /* options.legacySettings 模拟 Folium 1.x 的旧名 .params / subscribe */
          if (options.legacySettings) {
            return {
              params: {
                get: () => ({ ...values }),
                subscribe: () => () => {},
              },
            };
          }
          return {
            settings: {
              get: () => ({ ...values }),
              onChange: () => () => {},
            },
          };
        },
      },
    },
    events: {
      on(type, handler) {
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type).push(handler);
        return () => {
          const list = handlers.get(type) || [];
          const i = list.indexOf(handler);
          if (i !== -1) list.splice(i, 1);
        };
      },
    },
    playback,
  };
  return {
    folium,
    values,
    logs,
    playback,
    /** 派发一个事件给所有订阅者。 */
    fire(type, payload) {
      const list = (handlers.get(type) || []).slice();
      for (const h of list) h(payload);
    },
    /** 某级别的日志条数。 */
    count(level) {
      return logs.filter((l) => l[0] === level).length;
    },
    /** 是否记过包含某段文字的日志。 */
    said(text) {
      return logs.some((l) => String(l[1]).indexOf(text) !== -1);
    },
  };
}

/* ---- 断言 ---------------------------------------------------------------- */

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log('  PASS  ' + name);
  else {
    failures += 1;
    console.log('  FAIL  ' + name + (extra ? ' :: ' + extra : ''));
  }
}

/** 一个标准的失败事件。 */
function failEvent(reason, extra = {}) {
  return {
    song: { ref: 'song-1', id: '1', title: 'A', artist: 'B' },
    reason,
    phase: 'play',
    willAutoSkip: false,
    ...extra,
  };
}

/**
 * 让某首歌失败：宿主失败时 getState().song 就是这首歌，
 * 所以先同步假宿主的当前歌曲再派发事件 —— 否则模组会（正确地）认为
 * 「延迟期间已经换歌」而作废本次跳过。
 */
function failFor(h, ref, reason = 'unknown', extra = {}) {
  const song = { ref, id: ref, title: ref, artist: '' };
  h.playback.song = song;
  h.fire('playback.failed', { song, reason, phase: 'play', willAutoSkip: false, ...extra });
}

/* ---- 1. 基本跳过 --------------------------------------------------------- */

{
  const h = makeFolium({ delayMs: 0 });
  const dispose = activate(h.folium);
  h.fire('playback.failed', failEvent('unknown'));
  await sleep(120);
  check('unknown 失败会调用 next()', h.playback.nextCalls === 1, 'next=' + h.playback.nextCalls);
  check('日志记了跳过', h.said('已跳过'), JSON.stringify(h.logs));
  dispose();
}

/* ---- 2. willAutoSkip 时不插手 -------------------------------------------- */

{
  const h = makeFolium({ delayMs: 0 });
  const dispose = activate(h.folium);
  h.fire('playback.failed', failEvent('restricted', { willAutoSkip: true }));
  await sleep(120);
  check('willAutoSkip 时不调用 next()', h.playback.nextCalls === 0, 'next=' + h.playback.nextCalls);
  dispose();
}

/* ---- 3. restore 阶段不跳 ------------------------------------------------- */

{
  const h = makeFolium({ delayMs: 0 });
  const dispose = activate(h.folium);
  h.fire('playback.failed', failEvent('unknown', { phase: 'restore' }));
  await sleep(120);
  check('restore 阶段不调用 next()', h.playback.nextCalls === 0, 'next=' + h.playback.nextCalls);
  dispose();
}

/* ---- 4. 登录 / 网络类默认不跳，打开后才跳 -------------------------------- */

{
  const h = makeFolium({ delayMs: 0, skipAuthNetwork: false });
  const dispose = activate(h.folium);
  h.fire('playback.failed', failEvent('auth'));
  h.fire('playback.failed', failEvent('network'));
  await sleep(150);
  check('auth/network 默认不跳', h.playback.nextCalls === 0, 'next=' + h.playback.nextCalls);
  dispose();
}

{
  const h = makeFolium({ delayMs: 0, skipAuthNetwork: true });
  const dispose = activate(h.folium);
  h.fire('playback.failed', failEvent('auth'));
  await sleep(120);
  check('打开开关后 auth 会跳', h.playback.nextCalls === 1, 'next=' + h.playback.nextCalls);
  dispose();
}

/* ---- 5. 总开关 ----------------------------------------------------------- */

{
  const h = makeFolium({ delayMs: 0, enabled: false });
  const dispose = activate(h.folium);
  h.fire('playback.failed', failEvent('unknown'));
  await sleep(120);
  check('总开关关闭时不跳', h.playback.nextCalls === 0, 'next=' + h.playback.nextCalls);
  dispose();
}

/* ---- 6. skipUnplayable 关闭 ------------------------------------------------- */

{
  const h = makeFolium({ delayMs: 0, skipUnplayable: false });
  const dispose = activate(h.folium);
  h.fire('playback.failed', failEvent('unknown'));
  await sleep(120);
  check('skipUnplayable 关闭时不跳', h.playback.nextCalls === 0, 'next=' + h.playback.nextCalls);
  dispose();
}

/* ---- 7. 连续上限 --------------------------------------------------------- */

{
  const h = makeFolium({ delayMs: 0, maxConsecutiveSkips: 2, maxSkipsPerMinute: 60 });
  const dispose = activate(h.folium);
  failFor(h, 's1');
  await sleep(80);
  failFor(h, 's2');
  await sleep(80);
  failFor(h, 's3');
  await sleep(120);
  check('连续上限 2 生效（只跳 2 次）', h.playback.nextCalls === 2, 'next=' + h.playback.nextCalls);
  dispose();
}

{
  const h = makeFolium({ delayMs: 0, maxConsecutiveSkips: 0, maxSkipsPerMinute: 60 });
  const dispose = activate(h.folium);
  for (let i = 1; i <= 5; i += 1) {
    failFor(h, 's' + i);
    await sleep(50);
  }
  await sleep(120);
  check('0 = 不限（5 首都跳）', h.playback.nextCalls === 5, 'next=' + h.playback.nextCalls);
  dispose();
}

/* ---- 8. 播起来后计数归零 ------------------------------------------------- */

{
  const h = makeFolium({ delayMs: 0, maxConsecutiveSkips: 2, maxSkipsPerMinute: 60 });
  const dispose = activate(h.folium);
  failFor(h, 's1');
  await sleep(60);
  failFor(h, 's2');
  await sleep(60);
  // 播起来了 → 计数归零
  h.playback.state = 'playing';
  h.fire('playback.stateChanged', { state: 'playing' });
  await sleep(40);
  h.playback.state = 'stopped';
  failFor(h, 's3');
  await sleep(60);
  failFor(h, 's4');
  await sleep(120);
  check('播成功后计数归零（共跳 4 首）', h.playback.nextCalls === 4, 'next=' + h.playback.nextCalls);
  dispose();
}

/* ---- 9. 每分钟限流 ------------------------------------------------------- */

{
  const h = makeFolium({ delayMs: 0, maxSkipsPerMinute: 2, maxConsecutiveSkips: 0 });
  const dispose = activate(h.folium);
  for (let i = 1; i <= 5; i += 1) {
    failFor(h, 's' + i);
    await sleep(40);
  }
  await sleep(120);
  check('每分钟上限 2 生效', h.playback.nextCalls === 2, 'next=' + h.playback.nextCalls);
  dispose();
}

/* ---- 10. 限流后不刷屏（1.3.0 的真实事故回归） ---------------------------- */

{
  const h = makeFolium({ delayMs: 0, maxSkipsPerMinute: 2, maxConsecutiveSkips: 0 });
  const dispose = activate(h.folium);
  for (let i = 1; i <= 40; i += 1) {
    failFor(h, 's' + i);
    await sleep(5);
  }
  await sleep(150);
  check('限流后告警不刷屏（warn <= 6 条）', h.count('warn') <= 6, 'warn=' + h.count('warn'));
  check('限流后确实没有再跳（只跳 2 首）', h.playback.nextCalls === 2, 'next=' + h.playback.nextCalls);
  dispose();
}

/* ---- 11. 同一首歌不重复排队 ---------------------------------------------- */

{
  const h = makeFolium({ delayMs: 60, maxSkipsPerMinute: 60 });
  const dispose = activate(h.folium);
  const ev = failEvent('unknown');
  h.fire('playback.failed', ev);
  h.fire('playback.failed', ev);
  h.fire('playback.failed', ev);
  await sleep(220);
  check('同一首歌连发三次只跳一次', h.playback.nextCalls === 1, 'next=' + h.playback.nextCalls);
  dispose();
}

/* ---- 12. 延迟期间换歌则作废 ---------------------------------------------- */

{
  const h = makeFolium({ delayMs: 300, maxSkipsPerMinute: 60 });
  const dispose = activate(h.folium);
  h.fire('playback.failed', failEvent('unknown', { song: { ref: 'old' } }));
  await sleep(60);
  // 宿主已经换了歌
  h.playback.song = { ref: 'new' };
  h.fire('playback.songChanged', { song: { ref: 'new' } });
  await sleep(420);
  check('换歌后作废排队的跳过', h.playback.nextCalls === 0, 'next=' + h.playback.nextCalls);
  dispose();
}

/* ---- 13. dispose 后不再动作 ---------------------------------------------- */

{
  const h = makeFolium({ delayMs: 200, maxSkipsPerMinute: 60 });
  const dispose = activate(h.folium);
  h.fire('playback.failed', failEvent('unknown'));
  dispose();
  await sleep(320);
  check('dispose 后不跳', h.playback.nextCalls === 0, 'next=' + h.playback.nextCalls);
}

/* ---- 14. 宿主不支持时不启用 ---------------------------------------------- */

{
  const h = makeFolium({ delayMs: 0 }, { minor: 4 });
  const dispose = activate(h.folium);
  h.fire('playback.failed', failEvent('unknown'));
  await sleep(120);
  check('Folium 1.4 下不跳', h.playback.nextCalls === 0, 'next=' + h.playback.nextCalls);
  check('提示了版本过低', h.said('版本过低'), JSON.stringify(h.logs));
  dispose();
}

/* ---- 15. 没有 playback.control 时失败但不崩 ------------------------------ */

{
  const h = makeFolium({ delayMs: 0 });
  h.folium.playback.next = () => {
    throw new Error('permission-denied:playback.control');
  };
  const dispose = activate(h.folium);
  h.fire('playback.failed', failEvent('unknown'));
  await sleep(150);
  check('next() 抛权限错时不崩', true);
  check('记了失败日志', h.count('error') >= 1, 'error=' + h.count('error'));
  dispose();
}

/* ---- 16. 设置注册失败仍能工作 -------------------------------------------- */

{
  const h = makeFolium({ delayMs: 0 });
  h.folium.registries.settingsSections.register = () => {
    throw new Error('settingsSections.register: boom');
  };
  const dispose = activate(h.folium);
  h.fire('playback.failed', failEvent('unknown'));
  // 拿不到 params 时用默认值，默认 delayMs 是 250ms。
  await sleep(450);
  check('设置注册失败仍会跳（用默认值）', h.playback.nextCalls === 1, 'next=' + h.playback.nextCalls);
  dispose();
}

/* ---- 17. 不碰宿主 DOM ---------------------------------------------------- */

{
  const h = makeFolium({ delayMs: 0 });
  const touched = [];
  const realDocument = globalThis.document;
  globalThis.document = new Proxy(
    {},
    {
      get(_t, prop) {
        touched.push(String(prop));
        return undefined;
      },
    }
  );
  const dispose = activate(h.folium);
  h.fire('playback.failed', failEvent('unknown'));
  await sleep(150);
  globalThis.document = realDocument;
  check('全程没有访问 document', touched.length === 0, touched.join(','));
  check('没有 document 也照样跳', h.playback.nextCalls === 1, 'next=' + h.playback.nextCalls);
  dispose();
}

/* ---- 18. 设置访问器：新名 .settings / onChange 与旧名 .params / subscribe ---- */

{
  /* 新版宿主（Folium 2 契约）：只给 .settings + onChange */
  const h = makeFolium({ delayMs: 0, maxConsecutiveSkips: 1 });
  const dispose = activate(h.folium);
  h.fire('playback.failed', failEvent('unknown'));
  await sleep(120);
  check('新名 .settings 能读到设置', h.playback.nextCalls === 1, 'next=' + h.playback.nextCalls);
  dispose();

  /* 旧版宿主（Folium 1.x）：只有 .params + subscribe，仍要能工作 */
  const old = makeFolium({ delayMs: 0, maxConsecutiveSkips: 1, legacySettings: true });
  const disposeOld = activate(old.folium);
  old.fire('playback.failed', failEvent('unknown'));
  await sleep(120);
  check('旧名 .params 仍能读到设置', old.playback.nextCalls === 1, 'next=' + old.playback.nextCalls);
  disposeOld();
}

/* ---- 19. 新旧两套同时存在时取新名，且绝不碰弃用的 .params --------------- */

{
  const h = makeFolium({ delayMs: 0 });
  const stats = { get: 0, onChange: 0, subscribe: 0, legacyGet: 0, offCalled: 0 };
  h.folium.registries.settingsSections.register = () => ({
    settings: {
      get: () => {
        stats.get += 1;
        return { ...h.values };
      },
      onChange: () => {
        stats.onChange += 1;
        return () => {
          stats.offCalled += 1;
        };
      },
    },
    params: {
      get: () => {
        stats.legacyGet += 1;
        return { ...h.values };
      },
      subscribe: () => {
        stats.subscribe += 1;
        return () => {};
      },
    },
  });

  const dispose = activate(h.folium);
  check('订阅走新名 onChange', stats.onChange === 1, 'onChange=' + stats.onChange);
  check('没有走旧名 subscribe', stats.subscribe === 0, 'subscribe=' + stats.subscribe);

  h.fire('playback.failed', failEvent('unknown'));
  await sleep(120);
  check('读设置走新名 settings.get', stats.get > 0 && h.playback.nextCalls === 1, 'get=' + stats.get);
  check('旧名 params.get 一次都没被调用', stats.legacyGet === 0, 'legacyGet=' + stats.legacyGet);

  dispose();
  check('dispose 调用了 onChange 返回的退订函数', stats.offCalled === 1, 'off=' + stats.offCalled);
}

console.log(failures === 0 ? '\nALL INTEGRATION TESTS PASSED' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
