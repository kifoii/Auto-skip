/**
 * Folia · Folium mod — Auto skip
 *
 * 目标版本：Folia 0.7.20 / Folium 1.5
 *
 * ---------------------------------------------------------------------------
 * 一、原版现在做什么（0.7.20 起）
 * ---------------------------------------------------------------------------
 * 0.7.20 的宿主失败策略表 `o6`（bootstrap-sKOLp_Al.js）给每种失败一条策略：
 *
 *   not-signed-in / session-expired      → autoSkip:'none'  actions:['skip']
 *   membership-required / purchase-required / entitlement-required
 *   preview-only / region-restricted     → autoSkip:'none'  actions:['skip']
 *   taken-down                           → autoSkip:'countdown'
 *   network / timeout / service-unavailable / rate-limited
 *                                        → autoSkip:'none'  actions:['retry','skip']
 *   invalid-response / unknown           → autoSkip:'none'  actions:['retry','skip']
 *
 * 策略合成函数 `c6` 里有一句关键分支：
 *   n.autoSkipUnplayable && a.autoSkip === 'none' && Iae(e) &&
 *     (a = { ...a, autoSkip:'countdown', countdownKey: r6 })
 * 其中
 *   Fae = {membership-required, purchase-required, entitlement-required,
 *          preview-only, region-restricted, invalid-response, unknown}
 *   Iae = e => Fae.has(e.reason) && (e.reason !== 'unknown' || e.hint !== 'sign-in-may-help')
 *
 * 也就是说，原版设置项「无法播放时自动跳过」打开后，只把上面这批 reason 从
 * 'none' 改成倒计时（5 秒、连跳上限 2，见 h7 / g7）。**auth 与 network 两类
 * 按设计永远不跳**，那张卡会一直停在屏幕上等人点。
 *
 * 倒计时跳过还有一个安全护栏：宿主在 `m7` 里用 `a()`（isCurrent）判断这次失败
 * 是否仍属于当前歌曲，点击后会清掉倒计时定时器。所以本模组接管倒计时时一律
 * 走按钮上的回调，而不是自己调 next()。
 *
 * ---------------------------------------------------------------------------
 * 二、本模组的定位：与原版配合
 * ---------------------------------------------------------------------------
 *   1) 补原版不覆盖的部分：登录类 / 网络类失败（默认关，可在设置里打开）。
 *   2) 接管原版倒计时（可选）：原版固定等 5 秒，本模组可以立刻跳。
 *   3) 提示卡开关（默认开 = 不显示提示卡）：既然马上要跳，闪一下的红卡片是噪音。
 *      只有在「本模组或原版确实会为这张卡执行跳过」时才隐藏，否则保留提示，
 *      免得用户看不到失败原因。
 *   4) 倒计时自定义：可以在跳过前先弹一张自己控制的「N 秒后自动跳过」。
 *   5) 安全阀：每分钟上限、连续跳过上限、宿主放弃后继续推进。
 *
 * 设置项的权威定义走 Folium 官方的 settingsSections，渲染在
 * 选项 → 模组 → 展开本模组那一行。另外用 DOM 把一小组快捷开关插到原版
 * 「无法播放时自动跳过」那一行的下方（`injectPanel`，默认开）——官方
 * settingsSections 的文档明确写了它只渲染在模组面板，没有原版设置页锚点，
 * 所以只能靠 DOM。找不到锚点时静默跳过，不影响其它功能。
 *
 * ---------------------------------------------------------------------------
 * 三、怎么知道失败了
 * ---------------------------------------------------------------------------
 * 首选 Folium 1.5 的 `playback.failed` 事件：
 *   { song, reason, phase, willAutoSkip }
 *   reason ∈ 'auth' | 'restricted' | 'taken-down' | 'network' | 'unknown'
 * 它是权威信号，且宿主文档明确说明：
 *   willAutoSkip=true 时「宿主正在倒计时准备跳过，不要自己调 next()」。
 *
 *   host → mod 的事件分发是同栈同步的（noLyricLines-Dc7hcAw8.js 的 `Hl`/`Vl`），
 *   但宿主是先 setStatusMsg（React setState）再 notifyFailure，所以事件到达时
 *   提示卡还没提交到 DOM —— 任何依赖 DOM 的动作都必须延后一拍，本模组统一
 *   用 delayMs / countdownSeconds 覆盖这个时间差。
 *
 * 兜底：DOM 观察。宿主提示卡是 React portal 到 body 的 motion.div，class 固定含
 *   `fixed top-0 left-1/2 z-[210] px-6 py-3 backdrop-blur-md rounded-full`
 * 两类卡的按钮顺序【相反】，只能按文案找，不能按位置点：
 *   「暂时无法播放」卡  [icon][text][跳过(cancel槽)][重试(action槽)]
 *   「倒计时」卡        [icon][text][取消(cancel槽)][跳过(action槽)]
 * DOM 分类只能认出这两类；auth / network 的细分识别依赖事件。事件不可用时
 * 按下面的 DOM 文案表保守处理。
 *
 * ---------------------------------------------------------------------------
 * 四、怎么跳
 * ---------------------------------------------------------------------------
 * 宿主把真正的跳过回调挂在按钮的 React onClick 上（提示卡是 onCancel，倒计时卡
 * 是 onAction），本模组用 `__reactProps$<random>` 直接把那个函数取出来调用，
 * 完全绕过合成事件系统（skipMode:'direct'，默认）；也可以派发真实 click
 * （skipMode:'click'）。两者都走宿主自己的回调，因而自带队列推进、倒计时清理
 * 和 unavailableSkipCount 语义，与用户手点完全一致。
 * 只有在卡上找不到可识别的「跳过」按钮时才退回 `folium.playback.next()`。
 *
 * 本文件不 import 任何东西：模块从 folia-mod:// 协议加载，只能用全局对象。
 */

const LOG_PREFIX = '[auto-skip] ';

/* =========================================================================
 * 设置
 * ========================================================================= */

const DEFAULT_SETTINGS = Object.freeze({
  /** 总开关。 */
  enabled: true,
  /** 跳过方式：'direct' 直接调宿主的 React 回调，'click' 派发真实 DOM 点击。 */
  skipMode: 'direct',
  /** 跳过原版「无法播放时自动跳过」覆盖的那批失败（会员 / 下架 / 地区 / 原因不明…）。 */
  skipUnplayable: true,
  /** 登录类与网络类也跳过 —— 这是原版按设计永远不跳的两类。 */
  skipAuthNetwork: false,
  /** 看到失败卡后等多久再跳（毫秒）。 */
  delayMs: 250,
  /** 关闭提示卡：默认开（＝不显示）。只在确实会跳过时才隐藏。 */
  hideToast: true,
  /** 跳过前先弹一张自己的倒计时卡，秒数自定；0 = 不弹，直接跳。 */
  countdownSeconds: 0,
  /** 接管原版倒计时：打开后看到原版倒数卡立刻跳，不等满 5 秒。 */
  handleCountdown: false,
  /** 每分钟最多跳过多少首。 */
  maxSkipsPerMinute: 8,
  /** 连续跳过多少首后收手；0 = 不限。 */
  maxConsecutiveSkips: 0,
  /** 宿主因自己的上限放弃（停止播放）后，是否继续把队列推下去。 */
  resumeAfterGiveUp: true,
  /** 在原版设置页那一行下方插入本模组的快捷开关。 */
  injectPanel: true,
});

/** 跳过策略：直接调用宿主的 React 回调 / 模拟 DOM 点击。 */
const SKIP_MODES = Object.freeze(['direct', 'click']);

/** 公开 reason（FoliumPlaybackFailureReason）里属于「无法播放」的一类。 */
const UNPLAYABLE_REASONS = Object.freeze(['restricted', 'taken-down', 'unknown']);

/** 公开 reason 里属于「登录 / 网络」的一类 —— 原版永远不跳。 */
const AUTH_NETWORK_REASONS = Object.freeze(['auth', 'network']);

/** 原版设置项「无法播放时自动跳过」的三种语言文案（DOM 锚点）。 */
const NATIVE_LABELS = Object.freeze([
  '无法播放时自动跳过',
  "Skip songs that can't be played",
  'Lewati lagu yang tidak dapat diputar',
]);

/** 触发自动跳过的文案（zh-CN / en-US / id-ID，含「登录后可能可以播放」变体）。 */
const UNAVAILABLE_TEXTS = Object.freeze([
  '暂时无法播放这首歌',
  "Can't play this song right now",
  'Can\u2019t play this song right now',
  'Lagu ini belum dapat diputar saat ini',
]);

/**
 * 宿主自带倒计时提示的标记（status.songUnavailablePrompt /
 * status.songUnplayableSkipPrompt，形如「… {{seconds}} 秒后自动跳过」）。
 */
const COUNTDOWN_MARKERS = Object.freeze(['自动跳过', 'Auto-skipping', 'otomatis']);

/**
 * 宿主「正在跳过」的纯信息卡标记（没有按钮，绝不能插手）。
 * 必须用带上下文的片段，否则会误伤 Auto-skipping：
 *   zh  歌曲已下架，正在跳过
 *   en  Song has been taken down, skipping
 *   id  Lagu telah dihapus, dilewati   （倒计时版是 "…dilewati otomatis dalam N detik"）
 * 因此下面用 `, skipping` 而不是 `skipping`，并让 otomatis 优先判为 countdown。
 */
const SKIPPING_MARKERS = Object.freeze(['正在跳过', ', skipping', 'dilewati']);

/**
 * 按钮标签。宿主用 i18n key 取标签：
 *   skip   -> status.skipUnavailableAction  (跳过 / Skip / Lewati)
 *   retry  -> ui.retry                      (重试 / Retry / Coba Lagi)
 *   cancel -> status.cancel                 (取消 / Cancel / Batal)
 */
const SKIP_LABELS = Object.freeze(['跳过', 'Skip', 'Lewati']);
const RETRY_LABELS = Object.freeze(['重试', 'Retry', 'Coba Lagi']);
const CANCEL_LABELS = Object.freeze(['取消', 'Cancel', 'Batal']);

/**
 * 提示卡选择器。全 bundle 里只有提示卡和发布说明弹窗用 z-[210]，
 * isToastElement 再校验另外三个 class，两者一起才认。
 */
const TOAST_SELECTOR = '[class*="z-[210]"]';

/** 本模组注入到原版设置页的快捷面板标记。 */
const PANEL_ATTR = 'data-auto-skip-panel';
/** 被本模组隐藏的提示卡标记（配合注册的样式表生效）。 */
const HIDE_ATTR = 'data-auto-skip-hidden';
/** 本模组注册的样式表 id。 */
const STYLE_ID = 'auto-skip-ui';

/* ---- 时间常量 ---------------------------------------------------------- */

/** DOM 变化后的合并窗口。 */
const SWEEP_DEBOUNCE_MS = 250;
/** 派发 click 后回查是否真被接住。 */
const CLICK_VERIFY_MS = 400;
/** 节流统计窗口。 */
const RATE_WINDOW_MS = 60000;
/** 兜底轮询间隔（MutationObserver 之外的保险）。 */
const BACKSTOP_INTERVAL_MS = 2000;
/** 刚跳完之后的静默期，避免把残留的旧卡片再处理一遍。 */
const BUSY_GRACE_MS = 250;
/** 同类告警的最小间隔。 */
const WARN_COOLDOWN_MS = 30000;
/**
 * 同一张提示卡两次出手之间的冷却。
 * React 用 `${type}:${text}:${nonce ?? 0}` 当 toastKey，连续两次同样文案会
 * 【复用同一个 DOM 节点】，所以永久去重（WeakSet）会漏掉第二次；这里改成
 * 计数 + 冷却。
 */
const SAME_TOAST_COOLDOWN_MS = 2000;
/** 同一张卡最多出手几次。 */
const MAX_ATTEMPTS_PER_TOAST = 3;
/** 宿主放弃（停止播放）的判定窗口。 */
const GIVEUP_WINDOW_MS = 8000;
/** 宿主放弃后再推一次队列的延迟。 */
const RESUME_DELAY_MS = 800;
/** 失败事件与 DOM 卡片的关联窗口。 */
const FAILURE_MEMORY_MS = 15000;

/* =========================================================================
 * 纯函数（导出给测试）
 * ========================================================================= */

/** 折叠空白并 trim；非字符串一律返回空串。 */
function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

/** text 是否包含 list 里的任意一项。 */
function hasAny(text, list) {
  if (!text) return false;
  for (let i = 0; i < list.length; i += 1) {
    if (text.indexOf(list[i]) !== -1) return true;
  }
  return false;
}

/**
 * 是不是宿主的提示卡。
 * 四个 class 必须同时出现 —— 只匹配 z-[210] 会误伤发布说明弹窗。
 */
function isToastElement(el) {
  if (!el || !el.classList) return false;
  const cls = el.classList;
  return (
    cls.contains('fixed') &&
    cls.contains('top-0') &&
    cls.contains('left-1/2') &&
    cls.contains('z-[210]')
  );
}

/** 取提示卡的正文（第一个 span）。 */
function toastMessage(el) {
  if (!el || !el.querySelector) return '';
  const span = el.querySelector('span');
  return span ? normalizeText(span.textContent) : '';
}

/**
 * 把提示卡分三类：
 *   'skip-in-progress' 纯信息卡（没有按钮），绝不能插手
 *   'countdown'        原版正在倒计时准备跳过
 *   'unavailable'      「暂时无法播放这首歌」这类停住的失败卡
 *   其它               null
 */
function classifyToast(text) {
  if (!text) return null;
  if (hasAny(text, SKIPPING_MARKERS)) return 'skip-in-progress';
  if (hasAny(text, COUNTDOWN_MARKERS)) return 'countdown';
  if (hasAny(text, UNAVAILABLE_TEXTS)) return 'unavailable';
  return null;
}

/** 是否是「暂时无法播放」这类失败卡的文案。 */
function isUnavailableText(text) {
  return hasAny(text, UNAVAILABLE_TEXTS);
}

/** 归一化后的标签是否就是「跳过」。 */
function isSkipLabel(label) {
  const t = normalizeText(label);
  if (!t) return false;
  for (let i = 0; i < SKIP_LABELS.length; i += 1) {
    if (t === SKIP_LABELS[i]) return true;
  }
  return false;
}

/** 按钮文案是否命中给定标签表（整词相等，避免「跳过全部」这类误伤）。 */
function hasLabel(button, labels) {
  if (!button) return false;
  const text = normalizeText(button.textContent);
  if (!text) return false;
  for (let i = 0; i < labels.length; i += 1) {
    if (text === labels[i]) return true;
  }
  return false;
}

/**
 * 在提示卡里找「跳过」按钮。
 *
 * 两类卡的按钮槽位是相反的：
 *   失败卡 actions ['retry','skip'] → 跳过在 cancel 槽，重试在 action 槽
 *   倒计时卡                        → 跳过在 action 槽，取消在 cancel 槽
 * 所以一律按文案找。三条路径：
 *   1) 文案直接命中「跳过」
 *   2) 卡上有「重试」，且恰有另一个既不是重试也不是取消的按钮 —— 那是 skip 槽
 *   3) 卡上只有「跳过 / 取消」组合时，取非取消的那个
 * 找不到就返回 null（宁可不动，也不能点错按钮）。
 */
function findSkipButton(toast) {
  if (!toast || !toast.querySelectorAll) return null;
  const buttons = Array.prototype.slice.call(toast.querySelectorAll('button'));
  if (buttons.length === 0) return null;

  for (let i = 0; i < buttons.length; i += 1) {
    if (isSkipLabel(buttons[i].textContent)) return buttons[i];
  }

  const retry = buttons.filter(function (b) {
    return hasLabel(b, RETRY_LABELS);
  });
  const cancel = buttons.filter(function (b) {
    return hasLabel(b, CANCEL_LABELS);
  });

  if (retry.length > 0) {
    const rest = buttons.filter(function (b) {
      return retry.indexOf(b) === -1 && cancel.indexOf(b) === -1;
    });
    if (rest.length === 1) return rest[0];
    return null;
  }

  if (cancel.length > 0 && buttons.length === 2) {
    const rest = buttons.filter(function (b) {
      return cancel.indexOf(b) === -1;
    });
    if (rest.length === 1) return rest[0];
  }

  return null;
}

/** 读 React 挂在这个节点上的 props（自有键 `__reactProps$<random>`）。 */
function readReactProps(el) {
  if (!el) return null;
  const keys = Object.keys(el);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (key.indexOf('__reactProps$') === 0) return el[key] || null;
  }
  return null;
}

/** 取 onClick / onClickCapture。 */
function readClickHandler(el) {
  const props = readReactProps(el);
  if (!props) return null;
  const handler = props.onClick || props.onClickCapture;
  return typeof handler === 'function' ? handler : null;
}

/** 事件里的 song 取一个会话内稳定的键。 */
function songKey(song) {
  if (!song || typeof song !== 'object') return null;
  if (typeof song.ref === 'string' && song.ref) return 'r:' + song.ref;
  if (song.id !== null && song.id !== undefined && song.id !== '') return 'i:' + song.id;
  if (typeof song.title === 'string' && song.title) return 't:' + song.title;
  return null;
}

/** 当前界面语言（只用于本模组自己的文案）。 */
function detectLocale() {
  try {
    const raw = navigator && navigator.language ? String(navigator.language) : 'en';
    if (/^zh/i.test(raw)) return 'zh-CN';
    if (/^id/i.test(raw)) return 'id';
    return 'en';
  } catch (err) {
    return 'en';
  }
}

/** 本模组自己的文案表。 */
const PANEL_TEXT = {
  'zh-CN': {
    title: '自动跳过',
    hideToast: '关闭提示卡',
    hideToastDesc: '跳过前不显示那张红色卡片。只在确实会跳过时隐藏，否则保留提示。',
    countdown: '跳过前倒计时',
    countdownDesc: '秒。0 = 不倒数，直接跳。',
    authNetwork: '登录 / 网络类也跳过',
    authNetworkDesc: '原版对这两类按设计不跳。打开后本模组会接手。',
    takeOver: '接管原版倒计时',
    takeOverDesc: '原版固定等 5 秒。打开后立刻跳。',
    more: '更多设置：选项 → 模组 → Auto skip',
    autoSkippingIn: function (s) {
      return s + ' 秒后自动跳过';
    },
  },
  en: {
    title: 'Auto skip',
    hideToast: 'Hide the toast',
    hideToastDesc:
      'No red card before skipping. Only hidden when a skip will really happen.',
    countdown: 'Countdown before skipping',
    countdownDesc: 'Seconds. 0 = skip straight away.',
    authNetwork: 'Also skip sign-in / network',
    authNetworkDesc:
      'Stock never skips these two. Turn on and this mod takes them over.',
    takeOver: 'Take over the stock countdown',
    takeOverDesc: 'Stock always waits 5s. Turn on to skip at once.',
    more: 'More settings: Options → Mods → Auto skip',
    autoSkippingIn: function (s) {
      return 'Auto-skipping in ' + s + 's';
    },
  },
  id: {
    title: 'Lewati otomatis',
    hideToast: 'Sembunyikan notifikasi',
    hideToastDesc:
      'Tanpa kartu merah sebelum melewati. Hanya disembunyikan jika benar-benar dilewati.',
    countdown: 'Hitung mundur sebelum melewati',
    countdownDesc: 'Detik. 0 = langsung lewati.',
    authNetwork: 'Lewati juga login / jaringan',
    authNetworkDesc:
      'Bawaan tidak pernah melewati keduanya. Aktifkan agar mod ini mengambil alih.',
    takeOver: 'Ambil alih hitung mundur bawaan',
    takeOverDesc: 'Bawaan selalu menunggu 5 detik. Aktifkan untuk segera melewati.',
    more: 'Pengaturan lain: Opsi → Mod → Auto skip',
    autoSkippingIn: function (s) {
      return 'Otomatis dilewati dalam ' + s + ' detik';
    },
  },
};

/** 给测试用的内部导出。 */
export const __internals = Object.freeze({
  normalizeText,
  hasAny,
  isToastElement,
  toastMessage,
  classifyToast,
  isUnavailableText,
  isSkipLabel,
  hasLabel,
  findSkipButton,
  readReactProps,
  readClickHandler,
  songKey,
  detectLocale,
  DEFAULT_SETTINGS,
  SKIP_MODES,
  UNPLAYABLE_REASONS,
  AUTH_NETWORK_REASONS,
  NATIVE_LABELS,
  UNAVAILABLE_TEXTS,
  COUNTDOWN_MARKERS,
  SKIPPING_MARKERS,
  SKIP_LABELS,
  RETRY_LABELS,
  CANCEL_LABELS,
  TOAST_SELECTOR,
  PANEL_ATTR,
  HIDE_ATTR,
  STYLE_ID,
  PANEL_TEXT,
});

/* =========================================================================
 * 分组标签（设置面板里的分组标题）
 * ========================================================================= */

const GROUP_SKIP = { 'zh-CN': '自动跳过', en: 'Auto skip', id: 'Lewati otomatis' };
const GROUP_TOAST = { 'zh-CN': '提示卡', en: 'Toast', id: 'Notifikasi' };
const GROUP_COUNTDOWN = {
  'zh-CN': '原版倒计时',
  en: 'Stock countdown',
  id: 'Hitung mundur bawaan',
};
const GROUP_SAFETY = { 'zh-CN': '安全阀', en: 'Safety limits', id: 'Batas aman' };

/* =========================================================================
 * 入口
 * ========================================================================= */

export default function activate(folium) {
  const log = folium && folium.log ? folium.log : console;

  function info(msg) {
    try {
      log.info(LOG_PREFIX + msg);
    } catch (err) {
      /* logging must never break skipping */
    }
  }

  function warn(msg) {
    try {
      log.warn(LOG_PREFIX + msg);
    } catch (err) {
      /* ignore */
    }
  }

  function fail(msg, err) {
    try {
      log.error(LOG_PREFIX + msg, err && err.message ? err.message : String(err));
    } catch (e) {
      /* ignore */
    }
  }

  const locale = detectLocale();
  const T = PANEL_TEXT[locale] || PANEL_TEXT.en;

  /* ---- 权限与上下文探测 -------------------------------------------------- */

  /**
   * manifest 可见时才预判权限。
   * 读不到 manifest 就不预判 —— 让宿主在调用点自己 fail-closed 抛
   * permission-denied，比猜错了什么都不做要好。
   */
  function hasPermission(name) {
    try {
      const perms = folium && folium.manifest ? folium.manifest.permissions : null;
      if (!Array.isArray(perms)) return true;
      return perms.indexOf(name) !== -1;
    } catch (err) {
      return true;
    }
  }

  const canControl = hasPermission('playback.control');
  if (!canControl) {
    warn('mod.json 里没有 playback.control 权限，本模组无法跳过任何歌曲');
  }

  /* ---- 设置：官方 settingsSections（选项 → 模组 → 展开本模组） ----------- */

  let params = null;
  try {
    if (folium && folium.registries && folium.registries.settingsSections) {
      const handle = folium.registries.settingsSections.register({
        id: 'settings',
        label: { 'zh-CN': '自动跳过', en: 'Auto skip', id: 'Lewati otomatis' },
        description: {
          'zh-CN':
            '和原版配合：补上原版不跳的登录 / 网络类失败，可选接管原版倒计时，' +
            '并可以关掉那张提示卡。默认不接管原版行为。',
          en:
            'Works alongside the stock behaviour: covers the sign-in / network failures ' +
            'it never skips, can take over its countdown, and can hide the toast. ' +
            'Stock behaviour is left alone by default.',
          id:
            'Bekerja bersama perilaku bawaan: menangani kegagalan login / jaringan yang ' +
            'tidak pernah dilewati bawaan, dapat mengambil alih hitung mundur, dan ' +
            'menyembunyikan notifikasi. Bawaan dibiarkan apa adanya secara default.',
        },
        settings: [
          /* -- 自动跳过 -- */
          {
            key: 'enabled',
            type: 'boolean',
            label: { 'zh-CN': '启用自动跳过', en: 'Enable auto-skip', id: 'Aktifkan' },
            description: {
              'zh-CN': '总开关。关闭后本模组完全不介入任何提示卡。',
              en: 'Master switch. Off means the mod never touches any toast.',
              id: 'Saklar utama.',
            },
            group: GROUP_SKIP,
            defaultValue: DEFAULT_SETTINGS.enabled,
          },
          {
            key: 'skipUnplayable',
            type: 'boolean',
            label: {
              'zh-CN': '跳过无法播放的歌曲',
              en: 'Skip unplayable songs',
              id: 'Lewati lagu yang tidak dapat diputar',
            },
            description: {
              'zh-CN':
                '会员 / 购买 / 授权 / 仅试听 / 地区限制 / 已下架 / 原因不明。' +
                '原版的同名设置打开时它自己就会倒计时跳过；关掉时是被本模组接住。',
              en:
                'Membership, purchase, entitlement, preview-only, region, taken down, ' +
                'or an unknown reason. With the stock setting on, Folia already counts ' +
                'these down; with it off, this mod picks them up.',
              id:
                'Keanggotaan, pembelian, hak, pratinjau, wilayah, dihapus, atau alasan ' +
                'tidak diketahui.',
            },
            group: GROUP_SKIP,
            defaultValue: DEFAULT_SETTINGS.skipUnplayable,
          },
          {
            key: 'skipAuthNetwork',
            type: 'boolean',
            label: {
              'zh-CN': '登录 / 网络类也跳过',
              en: 'Also skip sign-in / network',
              id: 'Lewati juga login / jaringan',
            },
            description: {
              'zh-CN':
                '原版对「需要登录」和网络问题按设计永不跳过，卡片会一直停在那里。' +
                '打开后本模组接手这两类。注意网络抖动时连跳可能会跳过本来能放的歌。',
              en:
                'Stock Folia never skips "sign in required" or network problems, so the ' +
                'card just sits there. When on, this mod takes those over. Careful: on a ' +
                'flaky network it may skip songs that would have played.',
              id:
                'Bawaan tidak pernah melewati "perlu login" atau masalah jaringan. ' +
                'Jika aktif, mod ini mengambil alih keduanya.',
            },
            group: GROUP_SKIP,
            defaultValue: DEFAULT_SETTINGS.skipAuthNetwork,
          },
          {
            key: 'delayMs',
            type: 'number',
            label: {
              'zh-CN': '跳过前延迟（毫秒）',
              en: 'Delay before skipping (ms)',
              id: 'Jeda sebelum melewati (ms)',
            },
            description: {
              'zh-CN':
                '看到失败卡后等多久再跳。宿主是先建卡再发事件，所以至少要留几十毫秒' +
                '让卡片挂到 DOM 上，才能走「调用卡片按钮」这条最稳的路径。',
              en:
                'How long to wait before skipping. The host builds the card before it ' +
                'emits the event, so leave a little room for the card to mount.',
              id: 'Berapa lama menunggu sebelum melewati.',
            },
            group: GROUP_SKIP,
            defaultValue: DEFAULT_SETTINGS.delayMs,
            min: 0,
            max: 5000,
            step: 50,
          },
          {
            key: 'skipMode',
            type: 'select',
            label: {
              'zh-CN': '跳过方式',
              en: 'How to skip',
              id: 'Cara melewati',
            },
            description: {
              'zh-CN':
                '直接调用 = 读按钮上的 React 回调直接调，不派发 DOM 事件；' +
                '模拟点击 = 派发真实 click 交给 React 的委托监听器。' +
                '两者都走宿主自己的 skip，行为跟手点一样。',
              en:
                'Direct invokes the button\'s React callback without dispatching a DOM ' +
                'event; click dispatches a real click for React\'s delegated listener. ' +
                'Both call the host\'s own skip, so the result matches a real click.',
              id:
                'Langsung memanggil callback React tombol; klik mengirim klik DOM asli. ' +
                'Keduanya memakai skip milik bawaan.',
            },
            group: GROUP_SKIP,
            defaultValue: DEFAULT_SETTINGS.skipMode,
            options: [
              { value: 'direct', label: { 'zh-CN': '直接调用', en: 'Direct call', id: 'Panggil langsung' } },
              { value: 'click', label: { 'zh-CN': '模拟点击', en: 'Simulated click', id: 'Klik simulasi' } },
            ],
          },

          /* -- 提示卡 -- */
          {
            key: 'hideToast',
            type: 'boolean',
            label: {
              'zh-CN': '关闭提示卡',
              en: 'Hide the toast',
              id: 'Sembunyikan notifikasi',
            },
            description: {
              'zh-CN':
                '默认开（＝不显示）。既然马上要跳，闪一下的红卡片只是噪音。' +
                '只有在「确实会为这张卡执行跳过」时才隐藏，否则保留，免得看不到失败原因。',
              en:
                'On by default (so the card is hidden). If a skip is coming anyway the ' +
                'card is just noise. Only hidden when a skip will really happen.',
              id:
                'Aktif secara default. Hanya disembunyikan jika benar-benar akan dilewati.',
            },
            group: GROUP_TOAST,
            defaultValue: DEFAULT_SETTINGS.hideToast,
          },
          {
            key: 'countdownSeconds',
            type: 'number',
            label: {
              'zh-CN': '跳过前倒计时（秒）',
              en: 'Countdown before skipping (s)',
              id: 'Hitung mundur sebelum melewati (detik)',
            },
            description: {
              'zh-CN':
                '大于 0 时，先弹一张本模组自己的「N 秒后自动跳过」再跳；' +
                '0（默认）= 不倒数，延迟到时直接跳。原版固定 5 秒，这里可以自定义。',
              en:
                'Above 0, this mod shows its own "auto-skipping in Ns" first. ' +
                '0 (default) skips straight away. Stock hard-codes 5s; this is yours.',
              id: 'Di atas 0, mod ini menampilkan hitung mundurnya sendiri.',
            },
            group: GROUP_TOAST,
            defaultValue: DEFAULT_SETTINGS.countdownSeconds,
            min: 0,
            max: 10,
            step: 1,
          },

          /* -- 原版倒计时 -- */
          {
            key: 'handleCountdown',
            type: 'boolean',
            label: {
              'zh-CN': '接管原版倒计时',
              en: 'Take over the stock countdown',
              id: 'Ambil alih hitung mundur bawaan',
            },
            description: {
              'zh-CN':
                '原版对「已下架」或设置了自动跳过的歌曲会自己倒数 5 秒。' +
                '默认关：让它自己走完，本模组不插手。打开则由本模组立刻跳。',
              en:
                'Stock Folia counts 5s down by itself for taken-down songs and for ' +
                'whatever its own setting covers. Off by default; turn on to skip at once.',
              id:
                'Bawaan menghitung 5 detik sendiri. Nonaktif secara default; aktifkan ' +
                'untuk segera melewati.',
            },
            group: GROUP_COUNTDOWN,
            defaultValue: DEFAULT_SETTINGS.handleCountdown,
          },

          /* -- 安全阀 -- */
          {
            key: 'maxSkipsPerMinute',
            type: 'number',
            label: {
              'zh-CN': '每分钟最多跳过',
              en: 'Max skips per minute',
              id: 'Maksimum lewati per menit',
            },
            description: {
              'zh-CN': '硬性节流，防止整张歌单都失效时失控。',
              en: 'Hard throttle against a runaway loop when a whole queue fails.',
              id: 'Pembatas keras agar tidak terjadi perulangan tanpa henti.',
            },
            group: GROUP_SAFETY,
            defaultValue: DEFAULT_SETTINGS.maxSkipsPerMinute,
            min: 1,
            max: 60,
            step: 1,
          },
          {
            key: 'maxConsecutiveSkips',
            type: 'number',
            label: {
              'zh-CN': '连续跳过上限（0 = 不限）',
              en: 'Max consecutive skips (0 = unlimited)',
              id: 'Batas lewati berurutan (0 = tanpa batas)',
            },
            description: {
              'zh-CN':
                '连续自动跳过多少首之后收手。原版自己的上限是 2，超过就放弃整条队列；' +
                '0（默认）表示一直跳到能播放为止。',
              en:
                'How many consecutive auto-skips before backing off. Stock caps itself at ' +
                '2 then gives up; 0 (default) keeps going until something plays.',
              id: 'Berapa kali lewati berurutan sebelum berhenti. Bawaan 0 = tanpa batas.',
            },
            group: GROUP_SAFETY,
            defaultValue: DEFAULT_SETTINGS.maxConsecutiveSkips,
            min: 0,
            max: 50,
            step: 1,
          },
          {
            key: 'resumeAfterGiveUp',
            type: 'boolean',
            label: {
              'zh-CN': '宿主放弃后继续推进',
              en: 'Keep going after the host gives up',
              id: 'Lanjut setelah host menyerah',
            },
            description: {
              'zh-CN':
                '宿主连跳达到自己的上限后会停播。开启后本模组在这个状态下再推一次队列，' +
                '这样「连续跳过上限」才能真正设到 2 以上。',
              en:
                'Stock stops playback once its own cap is hit. When on, this mod nudges the ' +
                'queue forward so a consecutive cap above 2 actually works.',
              id:
                'Folia berhenti setelah batasnya tercapai. Jika aktif, mod ini mendorong antrean.',
            },
            group: GROUP_SAFETY,
            defaultValue: DEFAULT_SETTINGS.resumeAfterGiveUp,
          },
          {
            key: 'injectPanel',
            type: 'boolean',
            label: {
              'zh-CN': '在原版设置下方显示快捷开关',
              en: 'Show quick switches under the stock setting',
              id: 'Tampilkan saklar cepat di bawah pengaturan bawaan',
            },
            description: {
              'zh-CN':
                '把上面几个常用开关插到「选项 → 播放控制 → 无法播放时自动跳过」那一行的下方。' +
                '官方接口没有原版设置页锚点，这里是用 DOM 实现的，找不到那一行时会自动跳过。',
              en:
                'Puts the common switches right under Options → Playback → "Skip songs ' +
                'that can\'t be played". The official API has no stock-settings anchor, so ' +
                'this is DOM-based and silently gives up when the row is not there.',
              id:
                'Menaruh saklar umum tepat di bawah pengaturan bawaan. Berbasis DOM dan ' +
                'dilewati diam-diam bila barisnya tidak ada.',
            },
            group: GROUP_SAFETY,
            defaultValue: DEFAULT_SETTINGS.injectPanel,
          },
        ],
      });
      params = handle && handle.params ? handle.params : null;
    }
  } catch (err) {
    fail('注册设置区块失败（不影响自动跳过）', err);
  }

  function readSettings() {
    const out = {};
    const keys = Object.keys(DEFAULT_SETTINGS);
    for (let i = 0; i < keys.length; i += 1) out[keys[i]] = DEFAULT_SETTINGS[keys[i]];
    if (!params) return out;
    try {
      const v = params.get();
      if (!v || typeof v !== 'object') return out;
      if (typeof v.enabled === 'boolean') out.enabled = v.enabled;
      if (v.skipMode === 'direct' || v.skipMode === 'click') out.skipMode = v.skipMode;
      if (typeof v.skipUnplayable === 'boolean') out.skipUnplayable = v.skipUnplayable;
      if (typeof v.skipAuthNetwork === 'boolean') out.skipAuthNetwork = v.skipAuthNetwork;
      if (typeof v.delayMs === 'number' && Number.isFinite(v.delayMs)) {
        out.delayMs = Math.max(0, Math.min(5000, v.delayMs));
      }
      if (typeof v.hideToast === 'boolean') out.hideToast = v.hideToast;
      if (typeof v.countdownSeconds === 'number' && Number.isFinite(v.countdownSeconds)) {
        out.countdownSeconds = Math.max(0, Math.min(10, Math.round(v.countdownSeconds)));
      }
      if (typeof v.handleCountdown === 'boolean') out.handleCountdown = v.handleCountdown;
      if (typeof v.maxSkipsPerMinute === 'number' && Number.isFinite(v.maxSkipsPerMinute)) {
        out.maxSkipsPerMinute = Math.max(1, Math.min(60, v.maxSkipsPerMinute));
      }
      if (
        typeof v.maxConsecutiveSkips === 'number' &&
        Number.isFinite(v.maxConsecutiveSkips)
      ) {
        out.maxConsecutiveSkips = Math.max(0, Math.min(50, v.maxConsecutiveSkips));
      }
      if (typeof v.resumeAfterGiveUp === 'boolean') {
        out.resumeAfterGiveUp = v.resumeAfterGiveUp;
      }
      if (typeof v.injectPanel === 'boolean') out.injectPanel = v.injectPanel;
    } catch (err) {
      /* fall back to defaults */
    }
    return out;
  }

  function writeSetting(patch) {
    if (!params) return;
    try {
      params.set(patch);
    } catch (err) {
      fail('写入设置失败', err);
    }
  }

  /* ---- 运行时状态 -------------------------------------------------------- */

  /**
   * 每个提示卡节点记 {lastAt, count}，而不是简单 WeakSet。
   * 见 SAME_TOAST_COOLDOWN_MS 的注释：React 会复用相同 toastKey 的 DOM 节点，
   * 永久去重会漏掉「连续两首同样失败」的第二首。
   */
  const toastAttempts = new WeakMap();
  /**
   * 提示卡节点的稳定序号。
   * 排队的 key 必须认「这张卡」而不是「这段文案」—— 连续三首同样的失败，
   * 卡的文案一模一样，按文案去重会把第 2、3 首整片吞掉。
   */
  const toastIds = new WeakMap();
  let toastSeq = 0;
  let recentSkips = [];
  /** 连续自动跳过计数；下一次真正播起来时归零。 */
  let consecutiveSkips = 0;
  let lastSkipAt = 0;
  /**
   * 已经为哪次失败排过队。
   * 事件路径与 DOM 兜底路径都会走到同一张卡上，靠它保证只跳一次。
   */
  let plannedSkipFor = null;
  /**
   * 事件路径已经接手到哪个时刻为止。
   * 事件是权威信号，它排队之后 DOM 兜底要让路；但只让一小会儿，
   * 万一事件路径没成功（卡没挂上、回调读不到），DOM 兜底还得能接手。
   */
  let eventSkipUntil = 0;
  let pendingUntil = 0;
  let resumeTimer = null;
  let resumedForSkipAt = 0;
  let debounceTimer = null;
  let backstopTimer = null;
  let countdownTimer = null;
  let pendingSkipTimer = null;
  let lastWarnAt = 0;
  let disposed = false;

  /**
   * 最近一次失败事件的记忆，用来给 DOM 兜底分类补上「到底是哪一类」。
   * 事件是权威信号；DOM 只能认出失败卡与倒数卡，认不出 auth / network。
   */
  let recentFailure = null;
  /** 本模组隐藏过的提示卡节点，便于排查。 */
  let hiddenCount = 0;

  function shouldHandleToast(el) {
    const rec = toastAttempts.get(el);
    if (!rec) return true;
    if (rec.count >= MAX_ATTEMPTS_PER_TOAST) return false;
    return Date.now() - rec.lastAt >= SAME_TOAST_COOLDOWN_MS;
  }

  function noteToastAttempt(el) {
    const rec = toastAttempts.get(el);
    if (rec) {
      rec.lastAt = Date.now();
      rec.count += 1;
    } else {
      toastAttempts.set(el, { lastAt: Date.now(), count: 1 });
    }
  }

  /** 这张卡的稳定标识（同一节点永远同一个号）。 */
  function toastId(el) {
    let id = toastIds.get(el);
    if (id === undefined) {
      toastSeq += 1;
      id = toastSeq;
      toastIds.set(el, id);
    }
    return id;
  }

  function pruneSkips() {
    const now = Date.now();
    recentSkips = recentSkips.filter(function (at) {
      return now - at < RATE_WINDOW_MS;
    });
  }

  function capReached(settings) {
    return settings.maxConsecutiveSkips > 0 && consecutiveSkips >= settings.maxConsecutiveSkips;
  }

  function rateLimited(settings) {
    pruneSkips();
    if (recentSkips.length >= settings.maxSkipsPerMinute) {
      const now = Date.now();
      if (now - lastWarnAt > WARN_COOLDOWN_MS) {
        lastWarnAt = now;
        warn(
          '一分钟内已跳过 ' +
            recentSkips.length +
            ' 首，暂停自动跳过以避免无限连跳（可在设置里调整上限）'
        );
      }
      return true;
    }
    return false;
  }

  /** 记一次「本模组发起的跳过」，用于节流与连续计数。 */
  function noteSkip() {
    const now = Date.now();
    recentSkips.push(now);
    consecutiveSkips += 1;
    lastSkipAt = now;
  }

  function markBusy(extraMs) {
    pendingUntil = Date.now() + Math.max(0, extraMs) + BUSY_GRACE_MS;
  }

  function playbackState() {
    try {
      if (folium && folium.playback && typeof folium.playback.getState === 'function') {
        return folium.playback.getState();
      }
    } catch (err) {
      /* ignore */
    }
    return null;
  }

  function currentSongKey() {
    const snap = playbackState();
    return snap ? songKey(snap.song) : null;
  }

  /**
   * 播放真正跑起来了就把连续计数归零。
   *
   * 只看 state === 'playing' 就够了：任何会弹出失败卡的失败，宿主的策略里
   * stopPlayback 都是 true（见策略表 o6），所以失败发生时播放已经被停下。
   * 之后若还观察到 playing，那就是下一首真的放起来了。
   */
  function checkRecovery() {
    const snap = playbackState();
    if (!snap) return;
    if (snap.state === 'playing' && consecutiveSkips !== 0) {
      info('已恢复播放，连续跳过计数归零（此前 ' + consecutiveSkips + ' 首）');
      consecutiveSkips = 0;
    }
  }

  /**
   * 宿主因为自己的连跳上限（h7 = 2）放弃时会直接置 IDLE 停播。
   * 这时本模组再推一次队列，连续的「跳过上限」才能真正设到 2 以上。
   */
  function checkGiveUp(settings) {
    const snap = playbackState();
    if (!snap) return;
    if (snap.state !== 'stopped') return;
    if (!settings.resumeAfterGiveUp) return;
    if (recentSkips.length === 0) return;
    if (Date.now() - lastSkipAt > GIVEUP_WINDOW_MS) return;
    if (resumedForSkipAt === lastSkipAt) return;
    resumedForSkipAt = lastSkipAt;
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(function () {
      resumeTimer = null;
      if (disposed) return;
      warn('宿主已停止播放，继续推进队列');
      advanceQueue('host-gave-up');
    }, RESUME_DELAY_MS);
  }

  /* ---- 跳过执行 ---------------------------------------------------------- */

  /**
   * 直接调用宿主挂在按钮上的 React onClick（也就是宿主的跳过回调），
   * 不派发任何 DOM 点击事件。
   *
   * 为什么这样是对的：两类卡都把真正的跳过回调挂成按钮的 onClick
   *   失败卡：Lae 里 onCancel: n[o]  (o === 'skip')
   *   倒数卡：ce  里 onAction: i    (i -> t() 就是跳过，且会先 K() 清掉定时器)
   * 直接把那个函数调掉，等价于用户点它，但完全绕过 React 合成事件系统 ——
   * 不存在「合成事件没接住」这种失败模式，也不会漏掉宿主自己的清理逻辑。
   */
  function runSkipHandler(toast, mode) {
    const btn = findSkipButton(toast);
    if (!btn) return false;

    if (mode === 'click') {
      try {
        btn.click();
        return true;
      } catch (err) {
        fail('派发 DOM click 失败，改调 React 回调', err);
        const handler0 = readClickHandler(btn);
        if (handler0) {
          try {
            handler0();
            return true;
          } catch (err2) {
            fail('调用 React onClick 也失败', err2);
          }
        }
        return false;
      }
    }

    const handler = readClickHandler(btn);
    if (handler) {
      try {
        handler();
        return true;
      } catch (err) {
        fail('调用 React onClick 失败，改派发 click', err);
        try {
          btn.click();
          return true;
        } catch (err2) {
          fail('派发 DOM click 也失败', err2);
          return false;
        }
      }
    }

    try {
      btn.click();
      return true;
    } catch (err) {
      fail('按钮上既没有 React 回调，click 也失败', err);
      return false;
    }
  }

  /** 卡上没有可识别的「跳过」按钮时的退路。 */
  function advanceQueue(reason) {
    try {
      if (folium && folium.playback && typeof folium.playback.next === 'function') {
        folium.playback.next();
        info('已调用 playback.next()（' + reason + '）');
        return true;
      }
    } catch (err) {
      fail('调用 playback.next() 失败', err);
    }
    return false;
  }

  /**
   * 真正执行一次跳过。
   * 优先走提示卡按钮（宿主自己的回调，语义最完整）；
   * 没有卡或没有按钮时退回 playback.next()。
   *
   * 限流与连跳上限在这里兜底：事件路径与 DOM 兜底路径最后都汇到这儿，
   * 只在某一条路径上检查的话，另一条就能悄悄绕过上限一直跳下去。
   */
  function performSkip(toast, label, settings) {
    const s = settings || readSettings();
    if (!s.enabled) return false;
    if (rateLimited(s)) {
      warn('触发每分钟限流，本次不跳：' + label);
      return false;
    }
    if (capReached(s)) {
      warn('已达连续跳过上限（' + s.maxConsecutiveSkips + '），本次不跳：' + label);
      return false;
    }
    noteSkip();
    markBusy(s.delayMs);
    if (toast && toast.isConnected) {
      noteToastAttempt(toast);
      if (runSkipHandler(toast, s.skipMode)) {
        info('已跳过（' + s.skipMode + '）：' + label);
        return true;
      }
    }
    if (advanceQueue('no-skip-button')) {
      info('卡上没有「跳过」按钮，已改用 next()：' + label);
      return true;
    }
    warn('无法跳过：' + label);
    return false;
  }

  /** 同一张失败不要重复排队。 */
  function planSkip(key) {
    if (plannedSkipFor === key) return false;
    plannedSkipFor = key;
    return true;
  }

  function clearPlannedSkip() {
    plannedSkipFor = null;
  }

  function cancelPendingSkip() {
    if (pendingSkipTimer) {
      clearTimeout(pendingSkipTimer);
      pendingSkipTimer = null;
    }
    if (countdownTimer) {
      clearTimeout(countdownTimer);
      countdownTimer = null;
    }
    clearPlannedSkip();
  }

  /* ---- 隐藏提示卡 -------------------------------------------------------- */

  function ensureStyle() {
    try {
      if (!folium || !folium.registries || !folium.registries.styles) return;
      folium.registries.styles.register({
        id: STYLE_ID,
        css:
          '[' +
          HIDE_ATTR +
          ']{display:none !important;}\n' +
          '[' +
          PANEL_ATTR +
          ']{margin-top:1rem;padding-top:1rem;border-top:1px solid rgba(127,127,127,0.18);}\n' +
          '[' +
          PANEL_ATTR +
          '] .as-row{display:flex;align-items:flex-start;justify-content:space-between;' +
          'gap:0.75rem;padding:0.5rem 0;}\n' +
          '[' +
          PANEL_ATTR +
          '] .as-title{font-size:0.875rem;font-weight:500;color:var(--text-primary);}\n' +
          '[' +
          PANEL_ATTR +
          '] .as-desc{font-size:11px;opacity:0.5;color:var(--text-secondary);' +
          'max-width:420px;line-height:1.4;}\n' +
          '[' +
          PANEL_ATTR +
          '] .as-head{display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;}\n' +
          '[' +
          PANEL_ATTR +
          '] .as-badge{font-size:10px;padding:1px 6px;border-radius:999px;' +
          'background:rgba(127,127,127,0.18);color:var(--text-secondary);}\n' +
          '[' +
          PANEL_ATTR +
          '] .as-switch{position:relative;flex:none;width:36px;height:20px;border-radius:999px;' +
          'border:none;cursor:pointer;padding:0;transition:background 0.15s;}\n' +
          '[' +
          PANEL_ATTR +
          '] .as-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;' +
          'border-radius:999px;background:#fff;transition:transform 0.15s;}\n' +
          '[' +
          PANEL_ATTR +
          '] .as-num{width:64px;flex:none;font-size:12px;text-align:center;border-radius:6px;' +
          'padding:2px 4px;border:1px solid rgba(127,127,127,0.3);background:transparent;' +
          'color:var(--text-primary);}\n' +
          '[' +
          PANEL_ATTR +
          '] .as-foot{font-size:11px;opacity:0.4;color:var(--text-secondary);' +
          'padding-top:0.5rem;}',
      });
    } catch (err) {
      fail('注册样式表失败（面板会退化成无样式，不影响跳过）', err);
    }
  }

  /** 这张卡会不会真的被跳过（决定要不要隐藏它）。 */
  function willReallySkip(kind, settings, toast) {
    if (recentFailure && Date.now() - recentFailure.at < FAILURE_MEMORY_MS) {
      if (recentFailure.willAutoSkip) return true;
      const reason = recentFailure.reason;
      if (UNPLAYABLE_REASONS.indexOf(reason) !== -1) return settings.skipUnplayable;
      if (AUTH_NETWORK_REASONS.indexOf(reason) !== -1) return settings.skipAuthNetwork;
      return false;
    }
    if (kind === 'countdown') return settings.handleCountdown;
    if (kind === 'unavailable') return settings.skipUnplayable;
    if (kind === 'unplayable' && toast && findSkipButton(toast)) return settings.skipUnplayable;
    return false;
  }

  function hideToast(toast) {
    if (!toast || !toast.setAttribute) return;
    if (toast.getAttribute(HIDE_ATTR) === '1') return;
    try {
      toast.setAttribute(HIDE_ATTR, '1');
      hiddenCount += 1;
    } catch (err) {
      /* ignore */
    }
  }

  function unhideToast(toast) {
    if (!toast || !toast.removeAttribute) return;
    try {
      if (toast.getAttribute(HIDE_ATTR) === '1') toast.removeAttribute(HIDE_ATTR);
    } catch (err) {
      /* ignore */
    }
  }

  /* ---- DOM 兜底：扫描提示卡 ---------------------------------------------- */

  /** body 的元素子节点里找提示卡（portal 直接挂 body）。 */
  function collectToasts() {
    const out = [];
    if (typeof document === 'undefined' || !document.body) return out;
    const children = document.body.children;
    for (let i = 0; i < children.length; i += 1) {
      const el = children[i];
      if (el.nodeType === 1 && isToastElement(el)) out.push(el);
    }
    if (out.length === 0) {
      try {
        const found = document.querySelectorAll(TOAST_SELECTOR);
        for (let i = 0; i < found.length; i += 1) {
          if (isToastElement(found[i])) out.push(found[i]);
        }
      } catch (err) {
        /* ignore */
      }
    }
    return out;
  }

  function sweep() {
    if (disposed) return;
    const settings = readSettings();
    if (!settings.enabled) return;

    checkRecovery();
    checkGiveUp(settings);

    const toasts = collectToasts();
    for (let i = 0; i < toasts.length; i += 1) {
      const toast = toasts[i];
      const text = toastMessage(toast);
      const kind = classifyToast(text);
      if (!kind) continue;

      // 纯信息卡（「正在跳过」）没有按钮，绝不能插手。
      if (kind === 'skip-in-progress') continue;

      const real = willReallySkip(kind, settings, toast);
      if (real && settings.hideToast) {
        hideToast(toast);
      } else {
        unhideToast(toast);
      }

      if (Date.now() < pendingUntil) continue;

      if (kind === 'countdown') {
        if (!settings.handleCountdown) continue;
        if (!planSkip('countdown:' + toastId(toast))) continue;
        if (!shouldHandleToast(toast)) continue;
        scheduleSkip(toast, text, 'countdown', settings, 0);
        continue;
      }

      // kind === 'unavailable'
      if (!settings.skipUnplayable) continue;
      // 事件路径正在处理这次失败，别重复出手。
      if (Date.now() < eventSkipUntil) continue;
      if (!shouldHandleToast(toast)) continue;
      scheduleSkip(toast, text, 'unavailable', settings, settings.delayMs);
    }
  }

  /** 排一次跳过：delay 之后调用卡片按钮。 */
  function scheduleSkip(toast, label, kind, settings, delay) {
    const key = 'toast:' + kind + ':' + toastId(toast);
    if (!planSkip(key)) return;
    const wait = Math.max(0, delay);
    info('将在 ' + wait + 'ms 后跳过（' + kind + '）：' + label);
    pendingSkipTimer = setTimeout(function () {
      pendingSkipTimer = null;
      if (disposed) return;
      if (!toast || !toast.isConnected) {
        clearPlannedSkip();
        return;
      }
      const s = readSettings();
      if (!s.enabled) {
        clearPlannedSkip();
        return;
      }
      const ok = performSkip(toast, label, s);
      if (!ok) {
        clearPlannedSkip();
        warn('跳过失败，稍后可重试：' + label);
      }
      setTimeout(sweep, settings.delayMs + CLICK_VERIFY_MS);
    }, wait);
  }

  /* ---- 事件驱动：playback.failed ---------------------------------------- */

  /**
   * 宿主发来的失败通知。这是权威信号：
   *   reason ∈ auth | restricted | taken-down | network | unknown
   *   willAutoSkip=true 表示宿主正在倒计时准备跳过 —— 文档明确要求此时
   *   不要再自己调 next()，否则会连跳两首。
   */
  function onPlaybackFailed(ev) {
    if (disposed) return;
    try {
      const settings = readSettings();
      if (!settings.enabled || !ev || typeof ev !== 'object') return;

      const reason = typeof ev.reason === 'string' ? ev.reason : 'unknown';
      const willAutoSkip = ev.willAutoSkip === true;
      const key = songKey(ev.song);

      recentFailure = { at: Date.now(), reason: reason, willAutoSkip: willAutoSkip, key: key };

      const unplayable = UNPLAYABLE_REASONS.indexOf(reason) !== -1;
      const authNet = AUTH_NETWORK_REASONS.indexOf(reason) !== -1;

      if (willAutoSkip) {
        // 宿主正在倒计时。默认什么都不做，只是可能把卡藏掉。
        if (settings.handleCountdown && settings.hideToast) {
          info('原版正在倒计时（' + reason + '），按设置接管');
          scheduleCountdownTakeover(settings, key);
        } else {
          info('原版正在倒计时（' + reason + '），交给原版处理');
        }
        return;
      }

      // 宿主不会跳：看本模组要不要接手。
      if (unplayable && !settings.skipUnplayable) {
        info('失败（' + reason + '）但「跳过无法播放的歌曲」是关的，不动');
        return;
      }
      if (authNet && !settings.skipAuthNetwork) {
        info('失败（' + reason + '）原版与本模组都不跳过这类，保留提示卡');
        return;
      }
      if (!unplayable && !authNet) {
        info('失败（' + reason + '）不在接管范围，不动');
        return;
      }

      if (plannedSkipFor === 'event:' + reason + ':' + key) return;
      plannedSkipFor = 'event:' + reason + ':' + key;

      if (rateLimited(settings)) return;
      if (capReached(settings)) {
        warn('已达连续跳过上限（' + settings.maxConsecutiveSkips + '），本次不跳');
        return;
      }

      const label = reasonLabel(reason);
      const seconds = settings.countdownSeconds;
      if (seconds > 0) {
        try {
          if (folium && folium.ui && typeof folium.ui.toast === 'function') {
            folium.ui.toast(T.autoSkippingIn(seconds), {
              type: 'error',
              durationMs: seconds * 1000,
            });
          }
        } catch (err) {
          /* 提示失败不影响跳过 */
        }
      }

      const wait = Math.max(settings.delayMs, seconds * 1000);
      info('失败（' + reason + '），将在 ' + wait + 'ms 后跳过');
      // 让 DOM 兜底先别抢：这期间由事件路径负责。
      eventSkipUntil = Date.now() + wait + CLICK_VERIFY_MS;

      // 让 sweep 先把卡片挂上/藏好，再统一从 DOM 取按钮。
      setTimeout(sweep, 0);
      pendingSkipTimer = setTimeout(function () {
        pendingSkipTimer = null;
        if (disposed) return;
        const s = readSettings();
        if (!s.enabled) return;
        // 延迟期间歌曲已经换掉的话就作废。
        const nowKey = currentSongKey();
        if (key && nowKey && nowKey !== key) {
          info('延迟期间歌曲已改变，取消本次跳过');
          clearPlannedSkip();
          return;
        }
        if (capReached(s)) {
          clearPlannedSkip();
          return;
        }
        const toast = findFailureToast();
        const ok = performSkip(toast, label, s);
        if (!ok) clearPlannedSkip();
      }, wait);
    } catch (err) {
      fail('处理 playback.failed 事件出错', err);
    }
  }

  function reasonLabel(reason) {
    if (reason === 'auth') return 'login-required';
    if (reason === 'network') return 'network';
    if (reason === 'restricted') return 'restricted';
    if (reason === 'taken-down') return 'taken-down';
    return 'unknown';
  }

  /** 找到当前屏幕上那张失败卡（拿它的按钮回调）。 */
  function findFailureToast() {
    const toasts = collectToasts();
    for (let i = 0; i < toasts.length; i += 1) {
      const kind = classifyToast(toastMessage(toasts[i]));
      if (kind === 'countdown' || kind === 'unavailable') return toasts[i];
    }
    // 认不出文案也没关系：只要卡上有「跳过」按钮就能用。
    for (let i = 0; i < toasts.length; i += 1) {
      if (findSkipButton(toasts[i])) return toasts[i];
    }
    return null;
  }

  /** 接管原版倒计时：等卡片挂好，然后调它的按钮（顺带清掉原版定时器）。 */
  function scheduleCountdownTakeover(settings, key) {
    if (plannedSkipFor === 'takeover:' + key) return;
    plannedSkipFor = 'takeover:' + key;
    setTimeout(function () {
      if (disposed) return;
      const s = readSettings();
      if (!s.enabled || !s.handleCountdown) return;
      const toast = findFailureToast();
      if (!toast) {
        clearPlannedSkip();
        return;
      }
      if (rateLimited(s)) return;
      performSkip(toast, 'countdown-takeover', s);
    }, Math.max(0, settings.delayMs));
  }

  /* ---- 原版设置页下方的快捷面板 ------------------------------------------ */

  let panelRoot = null;
  let panelHost = null;
  let paramsUnsubscribe = null;

  function makeSwitch(value, onChange) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'as-switch';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', value ? 'true' : 'false');
    btn.style.background = value ? 'var(--accent-color, #3b82f6)' : 'rgba(127,127,127,0.35)';
    const knob = document.createElement('span');
    knob.className = 'as-knob';
    knob.style.transform = value ? 'translateX(16px)' : 'none';
    btn.appendChild(knob);
    btn.addEventListener('click', function () {
      const next = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', next ? 'true' : 'false');
      btn.style.background = next ? 'var(--accent-color, #3b82f6)' : 'rgba(127,127,127,0.35)';
      knob.style.transform = next ? 'translateX(16px)' : 'none';
      onChange(next);
    });
    return btn;
  }

  function makeRow(title, desc, control) {
    const row = document.createElement('div');
    row.className = 'as-row';
    const left = document.createElement('div');
    left.style.minWidth = '0';
    const t = document.createElement('div');
    t.className = 'as-title';
    t.textContent = title;
    left.appendChild(t);
    if (desc) {
      const d = document.createElement('div');
      d.className = 'as-desc';
      d.textContent = desc;
      left.appendChild(d);
    }
    row.appendChild(left);
    row.appendChild(control);
    return row;
  }

  function buildPanel() {
    const settings = readSettings();
    const root = document.createElement('div');
    root.setAttribute(PANEL_ATTR, '1');

    const head = document.createElement('div');
    head.className = 'as-head';
    const h = document.createElement('div');
    h.className = 'as-title';
    h.textContent = T.title;
    const badge = document.createElement('span');
    badge.className = 'as-badge';
    badge.textContent = 'mod';
    head.appendChild(h);
    head.appendChild(badge);
    root.appendChild(head);

    root.appendChild(
      makeRow(T.hideToast, T.hideToastDesc, makeSwitch(settings.hideToast, function (v) {
        writeSetting({ hideToast: v });
      }))
    );

    const num = document.createElement('input');
    num.type = 'number';
    num.className = 'as-num';
    num.min = '0';
    num.max = '10';
    num.step = '1';
    num.value = String(settings.countdownSeconds);
    num.addEventListener('change', function () {
      let v = parseInt(num.value, 10);
      if (!Number.isFinite(v)) v = 0;
      v = Math.max(0, Math.min(10, v));
      num.value = String(v);
      writeSetting({ countdownSeconds: v });
    });
    root.appendChild(makeRow(T.countdown, T.countdownDesc, num));

    root.appendChild(
      makeRow(T.authNetwork, T.authNetworkDesc, makeSwitch(settings.skipAuthNetwork, function (v) {
        writeSetting({ skipAuthNetwork: v });
      }))
    );

    root.appendChild(
      makeRow(T.takeOver, T.takeOverDesc, makeSwitch(settings.handleCountdown, function (v) {
        writeSetting({ handleCountdown: v });
      }))
    );

    const foot = document.createElement('div');
    foot.className = 'as-foot';
    foot.textContent = T.more;
    root.appendChild(foot);

    return root;
  }

  /** React 可能把注入的节点一起清掉，所以每次扫描都检查还在不在。 */
  function syncPanelControls() {
    if (!panelRoot || !panelRoot.isConnected) return;
    const settings = readSettings();
    const switches = panelRoot.querySelectorAll('.as-switch');
    const values = [settings.hideToast, settings.skipAuthNetwork, settings.handleCountdown];
    for (let i = 0; i < switches.length && i < values.length; i += 1) {
      const on = values[i] === true;
      switches[i].setAttribute('aria-checked', on ? 'true' : 'false');
      switches[i].style.background = on ? 'var(--accent-color, #3b82f6)' : 'rgba(127,127,127,0.35)';
      const knob = switches[i].querySelector('.as-knob');
      if (knob) knob.style.transform = on ? 'translateX(16px)' : 'none';
    }
    const input = panelRoot.querySelector('.as-num');
    if (input && document.activeElement !== input) {
      input.value = String(settings.countdownSeconds);
    }
  }

  /** 找原版那一行：文本恰为「无法播放时自动跳过」，且在设置卡里。 */
  function findNativeRow() {
    if (typeof document === 'undefined') return null;
    let nodes;
    try {
      nodes = document.querySelectorAll('div.text-sm.font-medium');
    } catch (err) {
      return null;
    }
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      const text = normalizeText(el.textContent);
      if (!text) continue;
      let matched = false;
      for (let j = 0; j < NATIVE_LABELS.length; j += 1) {
        if (text === NATIVE_LABELS[j]) {
          matched = true;
          break;
        }
      }
      if (!matched) continue;
      const section = el.closest ? el.closest('section[data-settings-anchor]') : null;
      if (!section) continue;
      let row = el.parentElement;
      while (row && row !== section) {
        const cls = row.classList;
        if (cls && cls.contains('items-start') && cls.contains('justify-between')) {
          return { row: row, section: section };
        }
        row = row.parentElement;
      }
      // 没找到标准的行容器就退一步，插到 label 的祖父节点之后。
      const fallback = el.parentElement ? el.parentElement.parentElement : null;
      if (fallback) return { row: fallback, section: section };
    }
    return null;
  }

  function removePanel() {
    if (panelRoot && panelRoot.parentNode) {
      try {
        panelRoot.parentNode.removeChild(panelRoot);
      } catch (err) {
        /* ignore */
      }
    }
    panelRoot = null;
    panelHost = null;
  }

  function ensurePanel() {
    if (disposed) return;
    const settings = readSettings();
    if (!settings.enabled || !settings.injectPanel) {
      if (panelRoot) removePanel();
      return;
    }
    const found = findNativeRow();
    if (!found) {
      if (panelRoot && panelRoot.isConnected) removePanel();
      return;
    }
    if (
      panelRoot &&
      panelRoot.isConnected &&
      panelHost === found.row &&
      panelRoot.previousSibling === found.row
    ) {
      syncPanelControls();
      return;
    }
    removePanel();
    try {
      panelRoot = buildPanel();
      panelHost = found.row;
      if (found.row.parentNode) found.row.parentNode.insertBefore(panelRoot, found.row.nextSibling);
    } catch (err) {
      fail('注入设置面板失败（不影响跳过）', err);
      panelRoot = null;
      panelHost = null;
    }
  }

  /* ---- 启动 -------------------------------------------------------------- */

  const eventDisposers = [];

  function subscribeEvents() {
    if (!folium || !folium.events || typeof folium.events.on !== 'function') {
      warn('宿主没有事件总线，只能靠 DOM 观察（登录 / 网络类无法区分）');
      return;
    }
    try {
      const dispose = folium.events.on('playback.failed', onPlaybackFailed);
      if (typeof dispose === 'function') eventDisposers.push(dispose);
      info('已订阅 playback.failed 事件');
    } catch (err) {
      fail('订阅 playback.failed 失败，退回纯 DOM 模式', err);
    }
    try {
      const dispose = folium.events.on('playback.songChanged', function () {
        // 换歌了就作废还没执行的排队跳过，避免跳错歌。
        if (pendingSkipTimer) {
          cancelPendingSkip();
        }
      });
      if (typeof dispose === 'function') eventDisposers.push(dispose);
    } catch (err) {
      /* 可选事件，失败无所谓 */
    }
  }

  let observer = null;

  function start() {
    if (typeof document === 'undefined' || !document.body) return;
    ensureStyle();
    subscribeEvents();

    if (params && typeof params.subscribe === 'function') {
      try {
        paramsUnsubscribe = params.subscribe(function () {
          syncPanelControls();
          setTimeout(ensurePanel, 0);
        });
      } catch (err) {
        /* 可选 */
      }
    }

    try {
      observer = new MutationObserver(function () {
        if (debounceTimer) return;
        debounceTimer = setTimeout(function () {
          debounceTimer = null;
          sweep();
          ensurePanel();
        }, SWEEP_DEBOUNCE_MS);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } catch (err) {
      fail('无法启动 MutationObserver，改用轮询', err);
    }

    backstopTimer = setInterval(function () {
      sweep();
      ensurePanel();
    }, BACKSTOP_INTERVAL_MS);

    sweep();
    ensurePanel();

    info(
      '已启用（Folia ' +
        ((folium && folium.host && folium.host.folia) || '?') +
        ' / Folium ' +
        ((folium && folium.host && folium.host.folium && folium.host.folium.major) || '?') +
        '.' +
        ((folium && folium.host && folium.host.folium && folium.host.folium.minor) || '?') +
        '，上下文 ' +
        ((folium && folium.env && folium.env.context) || '?') +
        '）'
    );
  }

  /** 清理：所有定时器、观察器、事件订阅、注入的 DOM。 */
  function dispose() {
    disposed = true;
    cancelPendingSkip();
    if (resumeTimer) clearTimeout(resumeTimer);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (backstopTimer) clearInterval(backstopTimer);
    if (observer && typeof observer.disconnect === 'function') observer.disconnect();
    if (panelRoot) removePanel();
    for (let i = 0; i < eventDisposers.length; i += 1) {
      try {
        eventDisposers[i]();
      } catch (err) {
        /* ignore */
      }
    }
    eventDisposers.length = 0;
    if (typeof paramsUnsubscribe === 'function') {
      try {
        paramsUnsubscribe();
      } catch (err) {
        /* ignore */
      }
    }
    paramsUnsubscribe = null;
    const toasts = collectToasts();
    for (let i = 0; i < toasts.length; i += 1) unhideToast(toasts[i]);
    recentSkips = [];
    pendingUntil = 0;
    info('已停用：共隐藏 ' + hiddenCount + ' 张提示卡');
  }

  if (typeof document === 'undefined') {
    warn('没有 document，本模组只在桌面版主窗口里工作');
  } else if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  return dispose;
}
