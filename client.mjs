/**
 * Folia · Folium mod — Auto skip
 *
 * 背景（Folia 0.7.19 / Folium 1.4）：
 *   播放失败时宿主用一张策略表决定提示（bootstrap-CN7j1yMM.js 的 `_6`）。
 *
 *   1) reason 为 `invalid-response` 或 `unknown` 的失败会落到
 *      `g6('status.songTemporarilyUnavailable')`，即
 *          { messageKey:'status.songTemporarilyUnavailable',
 *            stopPlayback:true, autoSkip:'none', actions:['retry','skip'] }
 *      —— autoSkip 是 'none'，宿主【不会】自动跳过，只显示一张常驻的
 *         「暂时无法播放这首歌 / 跳过 / 重试」提示卡，一直等用户点。
 *      用户日志里的 `not-playable` 就走这条：Hie() 把 not-playable 归到 `unknown`。
 *
 *   2) `taken-down`（歌曲已下架）的 autoSkip 是 'countdown'，宿主自己倒计时
 *      x7 = 5000ms 后跳过，但连续跳过上限 b7 = 2：第 3 次连跳时宿主直接
 *      `As($r.IDLE)` 放弃整条队列（跳过计数器 C.current，只有 taken-down 会 +1，
 *      其它 reason 一律归零）。
 *
 *   本模组=「全面接管」：既补上 (1) 这个宿主漏掉的分支，也能接管 (2) 的
 *   倒计时提示、并把连续跳过上限变成可调。
 *
 * 为什么用 DOM 而不是事件：
 *   Folium 1.4 只对外暴露 playback.beforePlay / lyrics.transform 两个 hook，
 *   以及 playback.songChanged|stateChanged|seeked|likeChanged、lyrics.loaded、
 *   theme.changed、app.viewChanged、visualizer.modeChanged 这些事件。
 *   没有任何「播放失败」事件，也没有 toast 拦截钩子；toast 的 model 是
 *   bootstrap 组件里的 React useState，连 internals 的 zustand store 都看不到
 *   （playback store 里没有 statusMsg 字段）。
 *   因此唯一精确的观测点就是提示卡本身。
 *
 * 怎么"跳过"（两种策略，都保留，可在设置里切换）：
 *
 *   direct（默认）——不模拟点击。宿主把真正的 skip 回调以 React onClick 的形式
 *     挂在按钮节点上（qie() 里 onCancel: n['skip']；倒计时卡里是 onAction: i），
 *     本模组用 React 的 __reactProps$<random> 属性直接取出那个函数并调用，
 *     完全绕过合成事件系统 —— 不存在"点击没被接住"这种失败模式。
 *
 *   click——模拟点击。读不到 props.onClick 时，或用户手动选择该模式时，派发
 *     一个真实 click（btn.click()），让 React 的委托监听器去接。
 *
 * 两种策略都走宿主自己的 skip 回调，而不是优先自己调 playback.next()，因为前者
 * 自带队列推进与 unavailableSkipCount 语义，和用户手点完全一致；
 * next() 在队列为空或 stage 模式激活时是 no-op（B8 的 canGo 判定）。
 * next() 只在两种情况用：提示卡上没有可识别的「跳过」按钮，或者宿主已经放弃
 * （IDLE）而我们要继续往下推（resumeAfterGiveUp）。
 *
 * 提示卡的 DOM：React portal 到 document.body 的一个 motion.div，class 固定为
 *   `fixed top-0 left-1/2 z-[210] px-6 py-3 backdrop-blur-md rounded-full ...`
 *
 *   两类卡的按钮顺序【相反】，只能靠文案认，不能靠位置：
 *     「暂时无法播放」卡  [icon][text][跳过(cancel槽)][重试(action槽)]
 *     「倒计时」卡        [icon][text][取消(cancel槽)][跳过(action槽)]
 *   所以本模组一律按按钮文案找「跳过」，找不到就什么都不做。
 *
 * 本文件不 import 任何东西（模块从 folia-mod:// 协议加载，只能用全局对象）。
 */

const LOG_PREFIX = '[auto-skip] ';

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  skipMode: 'direct',
  delayMs: 250,
  countdownDelayMs: 0,
  handleCountdown: true,
  maxSkipsPerMinute: 8,
  /** 连续自动跳过多少首后收手；0 = 不限（默认，和原版对这类失败"不设限"一致）。 */
  maxConsecutiveSkips: 0,
  /** 宿主因连续失败放弃（IDLE）后，是否由本模组继续把队列推下去。 */
  resumeAfterGiveUp: true,
});

/** 跳过策略：直接调用宿主的 React 回调 / 模拟 DOM 点击。 */
const SKIP_MODES = Object.freeze(['direct', 'click']);

/** 触发自动跳过的文案（zh-CN / en-US / id-ID，含「登录后可能可以播放」变体）。 */
const UNAVAILABLE_TEXTS = Object.freeze([
  '暂时无法播放这首歌',
  "Can't play this song right now",
  'Can\u2019t play this song right now',
  'Lagu ini belum dapat diputar saat ini',
]);

/**
 * 宿主自带倒计时提示的标记（status.songUnavailablePrompt /
 * status.playbackErrorPrompt，形如「… {{seconds}} 秒后自动跳过」）。
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

/** 提示卡容器选择器：整个 bundle 里只有提示卡和发布说明弹窗用 z-[210]。 */
const TOAST_SELECTOR = '[class*="z-[210]"]';

const SWEEP_DEBOUNCE_MS = 250;
const CLICK_VERIFY_MS = 400;
const RATE_WINDOW_MS = 60000;
const BACKSTOP_INTERVAL_MS = 2000;
/**
 * 本模组刚动完手之后的静默期：只用来避免对同一次界面变化重复出手。
 * 刻意设得短 —— 对「下一首同样失效」的新提示卡，越早跳越好，不该被长时间挡住。
 */
const BUSY_GRACE_MS = 250;
const WARN_COOLDOWN_MS = 30000;
/**
 * 同一个提示卡 DOM 节点在多长时间内不重复出手。
 *
 * 不能永久去重：React 用 toastKey = `${type}:${text}:${nonce??0}` 作为 key，
 * 连续两次同样文案的失败（例如 unknown 又 unknown）key 完全相同，
 * React 会【复用同一个 DOM 节点】。永久去重会导致第二首不再自动跳过。
 * 也不能完全不设门槛：一次界面变化会触发多次 MutationObserver 回调。
 */
const SAME_TOAST_COOLDOWN_MS = 2000;
/** 同一个节点最多出手几次，防死循环。 */
const MAX_ATTEMPTS_PER_TOAST = 3;
/** 距离上一次自动跳过多久以内，才认为「IDLE」是宿主放弃而不是正常放完。 */
const GIVEUP_WINDOW_MS = 8000;
/** 侦测到宿主放弃后，等这么久再推队列（给宿主自己的收尾留时间）。 */
const RESUME_DELAY_MS = 800;

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function hasAny(text, list) {
  for (let i = 0; i < list.length; i += 1) {
    if (text.indexOf(list[i]) !== -1) return true;
  }
  return false;
}

/** 是否是宿主的状态提示卡（必须同时具备四个定位 class，避开发布说明弹窗）。 */
function isToastElement(el) {
  if (!el || el.nodeType !== 1 || !el.classList) return false;
  const c = el.classList;
  return (
    c.contains('fixed') &&
    c.contains('top-0') &&
    c.contains('left-1/2') &&
    c.contains('z-[210]')
  );
}

/** 取提示卡的文案（第一个 span 就是文案，按钮标签是裸文本节点）。 */
function toastMessage(el) {
  let span = null;
  try {
    span = el.querySelector('span');
  } catch (err) {
    span = null;
  }
  return normalizeText(span ? span.textContent : el.textContent);
}

/**
 * 给提示卡分类，决定本模组该怎么处理：
 *   'skip-in-progress' —— 宿主已经在跳了（纯信息卡，无按钮），【绝不插手】；
 *   'countdown'        —— 宿主自带倒计时卡（下架 / 播放出错），可选接管；
 *   'unavailable'      —— 「暂时无法播放这首歌」，宿主漏掉的那类；
 *   null               —— 与本模组无关。
 */
function classifyToast(text) {
  const t = normalizeText(text);
  if (!t) return null;
  if (hasAny(t, SKIPPING_MARKERS) && !hasAny(t, COUNTDOWN_MARKERS)) {
    return 'skip-in-progress';
  }
  if (hasAny(t, COUNTDOWN_MARKERS)) return 'countdown';
  if (hasAny(t, UNAVAILABLE_TEXTS)) return 'unavailable';
  return null;
}

/** 是否属于「暂时无法播放」且不是宿主自带倒计时的那类提示（保留原语义）。 */
function isUnavailableText(text) {
  return classifyToast(text) === 'unavailable';
}

function isSkipLabel(label) {
  const t = normalizeText(label);
  return SKIP_LABELS.indexOf(t) !== -1;
}

function hasLabel(button, labels) {
  return labels.indexOf(normalizeText(button.textContent)) !== -1;
}

/**
 * 找「跳过」按钮。找不到就返回 null（调用方自己决定兜底或放弃）。
 *
 * ⚠ 绝不能「闭眼点第一个按钮」：两类卡的槽位顺序是相反的 ——
 *   「暂时无法播放」卡的第一个按钮是 跳过，而「倒计时」卡的第一个按钮是 取消，
 *   另外宿主在 mid-playback 场景可能拿不到 skip 回调，此时 qie() 过滤后只剩
 *   retry，提示卡渲染成 [取消][重试]（取消 = dismiss）。
 *   盲点第一个按钮会变成静默关闭提示卡而不跳歌。
 *
 * 三条路径：
 *   1. 文字命中 跳过 / Skip / Lewati —— 最可靠；
 *   2. 有「重试」按钮，且另有唯一一个既不是重试也不是取消的按钮 —— 它是 skip 槽位
 *      （未知语言包时仍能工作）；
 *   3. 其余情况一律返回 null。
 */
function findSkipButton(toast) {
  let buttons;
  try {
    buttons = Array.prototype.slice.call(toast.querySelectorAll('button'));
  } catch (err) {
    return null;
  }
  if (buttons.length === 0) return null;

  for (let i = 0; i < buttons.length; i += 1) {
    if (isSkipLabel(buttons[i].textContent)) return buttons[i];
  }

  let retrySeen = false;
  let inferred = null;
  let inferredCount = 0;
  for (let i = 0; i < buttons.length; i += 1) {
    if (hasLabel(buttons[i], RETRY_LABELS)) {
      retrySeen = true;
      continue;
    }
    if (hasLabel(buttons[i], CANCEL_LABELS)) continue;
    inferred = buttons[i];
    inferredCount += 1;
  }
  if (retrySeen && inferredCount === 1) return inferred;

  return null;
}

/** React 把 props 挂在 DOM 节点的 __reactProps$<random> 自有属性上。 */
function readReactProps(el) {
  let keys;
  try {
    keys = Object.keys(el);
  } catch (err) {
    return null;
  }
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i].indexOf('__reactProps$') === 0) {
      try {
        return el[keys[i]];
      } catch (err) {
        return null;
      }
    }
  }
  return null;
}

/**
 * 取出宿主挂在元素上的点击处理器（即 skip / retry / dismiss 回调本身）。
 * 返回 null 表示读不到（例如宿主换了 React 版本或用了非委托 handler）。
 */
function readClickHandler(el) {
  const props = readReactProps(el);
  if (!props) return null;
  if (typeof props.onClick === 'function') return props.onClick;
  if (typeof props.onClickCapture === 'function') return props.onClickCapture;
  return null;
}

export const __internals = Object.freeze({
  DEFAULT_SETTINGS,
  UNAVAILABLE_TEXTS,
  SKIP_LABELS,
  RETRY_LABELS,
  CANCEL_LABELS,
  COUNTDOWN_MARKERS,
  SKIPPING_MARKERS,
  TOAST_SELECTOR,
  normalizeText,
  classifyToast,
  isUnavailableText,
  isSkipLabel,
  hasLabel,
  isToastElement,
  toastMessage,
  findSkipButton,
  readReactProps,
  readClickHandler,
});

const GROUP_SKIP = {
  'zh-CN': '自动跳过',
  en: 'Auto skip',
  id: 'Lewati otomatis',
};
const GROUP_COUNTDOWN = {
  'zh-CN': '原版倒计时',
  en: 'Stock countdown',
  id: 'Hitung mundur bawaan',
};
const GROUP_SAFETY = {
  'zh-CN': '安全阀',
  en: 'Safety limits',
  id: 'Batas aman',
};

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

  // ---- 设置项（选项 → 模组 → 本模组的设置区块） ------------------------------
  let params = null;
  try {
    if (folium && folium.registries && folium.registries.settingsSections) {
      const handle = folium.registries.settingsSections.register({
        id: 'settings',
        label: {
          'zh-CN': '自动跳过',
          en: 'Auto skip',
          id: 'Lewati otomatis',
        },
        description: {
          'zh-CN':
            '接管播放失败提示：「暂时无法播放这首歌」自动跳过，' +
            '并可选接管原版的「下架 / 播放出错」倒计时与连续跳过上限。',
          en:
            'Takes over playback-failure toasts: skips "Can\u2019t play this song right now" ' +
            'automatically, and can also take over the stock countdown and consecutive-skip cap.',
          id:
            'Mengambil alih notifikasi gagal putar: melewati otomatis lagu yang tidak dapat diputar, ' +
            'dan dapat mengambil alih hitung mundur bawaan.',
        },
        settings: [
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
            key: 'skipMode',
            type: 'select',
            label: {
              'zh-CN': '跳过方式',
              en: 'Skip method',
              id: 'Metode lewati',
            },
            description: {
              'zh-CN':
                '直接调用 = 直接触发宿主的跳过回调，不模拟点击（推荐）。' +
                '模拟点击 = 派发真实的 click 事件。',
              en:
                'Direct = invoke the host\u2019s skip callback itself, no click simulation (recommended). ' +
                'Click = dispatch a real click event.',
              id:
                'Langsung = panggil callback lewati host, tanpa simulasi klik (disarankan). ' +
                'Klik = kirim event klik sungguhan.',
            },
            group: GROUP_SKIP,
            defaultValue: DEFAULT_SETTINGS.skipMode,
            options: [
              {
                value: 'direct',
                label: {
                  'zh-CN': '直接调用（推荐）',
                  en: 'Direct (recommended)',
                  id: 'Langsung',
                },
              },
              {
                value: 'click',
                label: { 'zh-CN': '模拟点击', en: 'Simulate click', id: 'Simulasi klik' },
              },
            ],
          },
          {
            key: 'delayMs',
            type: 'number',
            label: {
              'zh-CN': '「暂时无法播放」延迟（毫秒）',
              en: '"Can\u2019t play" delay (ms)',
              id: 'Jeda notifikasi (ms)',
            },
            description: {
              'zh-CN': '看到「暂时无法播放这首歌」后等多久再跳过。',
              en: 'How long to wait after the toast appears before skipping.',
              id: 'Berapa lama menunggu sebelum melewati.',
            },
            group: GROUP_SKIP,
            defaultValue: DEFAULT_SETTINGS.delayMs,
            min: 0,
            max: 5000,
            step: 50,
          },
          {
            key: 'handleCountdown',
            type: 'boolean',
            label: {
              'zh-CN': '接管原版倒计时',
              en: 'Take over stock countdown',
              id: 'Ambil alih hitung mundur',
            },
            description: {
              'zh-CN':
                '原版对「歌曲已下架 / 播放出错」会自己倒计时 5 秒后跳过。' +
                '开启后由本模组按下面的延迟提前跳过；关闭则完全不碰这类提示。',
              en:
                'Stock Folia counts down 5s before skipping taken-down / failed songs. ' +
                'On: this mod skips them early with the delay below. Off: leave them alone.',
              id:
                'Folia bawaan menghitung 5 detik sebelum melewati. ' +
                'Aktif: mod ini melewati lebih awal. Nonaktif: biarkan apa adanya.',
            },
            group: GROUP_COUNTDOWN,
            defaultValue: DEFAULT_SETTINGS.handleCountdown,
          },
          {
            key: 'countdownDelayMs',
            type: 'number',
            label: {
              'zh-CN': '倒计时卡片延迟（毫秒）',
              en: 'Countdown toast delay (ms)',
              id: 'Jeda hitung mundur (ms)',
            },
            description: {
              'zh-CN':
                '接管倒计时提示时等多久再跳过。0 = 立刻。' +
                '原版固定 5 秒，所以设得比 5000 大没有意义（那时原版已经自己跳了）。',
              en:
                'Delay before taking over a countdown toast. 0 = immediately. ' +
                'Stock waits 5s, so values above 5000 have no effect.',
              id: 'Jeda sebelum mengambil alih. 0 = segera. Bawaan 5 detik.',
            },
            group: GROUP_COUNTDOWN,
            defaultValue: DEFAULT_SETTINGS.countdownDelayMs,
            min: 0,
            max: 5000,
            step: 50,
          },
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
                '连续自动跳过多少首之后收手。原版对「下架」的硬编码上限是 2，' +
                '超过就放弃整条队列；0（默认）表示一直跳到能播放为止。',
              en:
                'How many consecutive auto-skips before backing off. Stock hard-codes 2 for ' +
                'taken-down songs then gives up; 0 (default) keeps going until something plays.',
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
                '宿主连跳达到自己的上限后会停播（IDLE）。开启后本模组在这个状态下' +
                '再推一次队列，这样「连续跳过上限」才能真正设到 2 以上。',
              en:
                'Stock stops playback (IDLE) once its own cap is hit. When on, this mod nudges ' +
                'the queue forward so a consecutive cap above 2 actually works.',
              id:
                'Folia berhenti setelah batasnya tercapai. Jika aktif, mod ini mendorong antrean ' +
                'agar batas di atas 2 benar-benar berfungsi.',
            },
            group: GROUP_SAFETY,
            defaultValue: DEFAULT_SETTINGS.resumeAfterGiveUp,
          },
        ],
      });
      params = handle && handle.params ? handle.params : null;
    }
  } catch (err) {
    fail('注册设置区块失败（不影响自动跳过）', err);
  }

  function readSettings() {
    const out = {
      enabled: DEFAULT_SETTINGS.enabled,
      skipMode: DEFAULT_SETTINGS.skipMode,
      delayMs: DEFAULT_SETTINGS.delayMs,
      countdownDelayMs: DEFAULT_SETTINGS.countdownDelayMs,
      handleCountdown: DEFAULT_SETTINGS.handleCountdown,
      maxSkipsPerMinute: DEFAULT_SETTINGS.maxSkipsPerMinute,
      maxConsecutiveSkips: DEFAULT_SETTINGS.maxConsecutiveSkips,
      resumeAfterGiveUp: DEFAULT_SETTINGS.resumeAfterGiveUp,
    };
    if (!params) return out;
    try {
      const v = params.get();
      if (v && typeof v === 'object') {
        if (typeof v.enabled === 'boolean') out.enabled = v.enabled;
        if (SKIP_MODES.indexOf(v.skipMode) !== -1) out.skipMode = v.skipMode;
        if (typeof v.delayMs === 'number' && Number.isFinite(v.delayMs)) {
          out.delayMs = Math.max(0, Math.min(5000, v.delayMs));
        }
        if (typeof v.countdownDelayMs === 'number' && Number.isFinite(v.countdownDelayMs)) {
          out.countdownDelayMs = Math.max(0, Math.min(5000, v.countdownDelayMs));
        }
        if (typeof v.handleCountdown === 'boolean') out.handleCountdown = v.handleCountdown;
        if (
          typeof v.maxSkipsPerMinute === 'number' &&
          Number.isFinite(v.maxSkipsPerMinute)
        ) {
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
      }
    } catch (err) {
      /* fall back to defaults */
    }
    return out;
  }

  // ---- 运行时状态 ------------------------------------------------------------
  /**
   * 每个提示卡节点记 {lastAt, count}，而不是简单 WeakSet。
   * 见 SAME_TOAST_COOLDOWN_MS 的注释：React 会复用相同 toastKey 的 DOM 节点，
   * 永久去重会漏掉「连续两首同样失败」的第二首。
   */
  const toastAttempts = new WeakMap();
  let recentSkips = [];
  /** 连续自动跳过计数；下一次真正播起来时归零。 */
  let consecutiveSkips = 0;
  let lastSkipAt = 0;
  let pendingUntil = 0;
  let resumeTimer = null;
  let resumedForSkipAt = 0;
  let debounceTimer = null;
  let backstopTimer = null;
  let verifyTimer = null;
  let busyTimer = null;
  let lastWarnAt = 0;
  let disposed = false;

  /** 这个节点现在还能不能再出手。 */
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

  function pruneSkips() {
    const now = Date.now();
    recentSkips = recentSkips.filter(function (at) {
      return now - at < RATE_WINDOW_MS;
    });
  }

  function capReached(settings) {
    return (
      settings.maxConsecutiveSkips > 0 && consecutiveSkips >= settings.maxConsecutiveSkips
    );
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
    if (busyTimer) clearTimeout(busyTimer);
    busyTimer = setTimeout(function () {
      busyTimer = null;
      pendingUntil = 0;
      sweep();
    }, Math.max(0, extraMs) + BUSY_GRACE_MS);
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

  /**
   * 直接调用宿主挂在按钮上的 React onClick（也就是宿主的跳过回调），
   * 不派发任何 DOM 点击事件。
   *
   * 为什么这样是对的：两类卡都把真正的跳过回调挂成按钮的 onClick
   *   提示卡：onCancel: n[o]  (o === 'skip')
   *   倒计时：onAction: i    (i → t() 就是跳过)
   * 直接把那个函数调掉，等价于用户点它，但完全绕过 React 合成事件系统 ——
   * 不存在「合成事件没接住」这种失败模式。
   *
   * mode === 'click' 时反过来：只派发 click，不碰 props。
   *
   * 返回是否成功触发跳过。
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
        fail('直接调用宿主跳过回调失败，退回到 DOM 点击', err);
      }
    } else {
      warn('读不到按钮的 React onClick，退回到 DOM 点击');
    }

    try {
      btn.click();
      return true;
    } catch (err) {
      fail('DOM 点击也失败', err);
      return false;
    }
  }

  /** 用 playback.next() 推一次队列（提示卡上没有跳过按钮，或宿主已放弃时）。 */
  function advanceQueue(reason) {
    if (!folium || !folium.playback || typeof folium.playback.next !== 'function') {
      warn(reason + '，且 playback.next() 不可用，放弃本次');
      return false;
    }
    noteSkip();
    info(reason + '，改用 playback.next() 推进队列');
    try {
      folium.playback.next();
      return true;
    } catch (err) {
      fail('playback.next() 失败', err);
      return false;
    }
  }

  function performSkip(toast, text, kind) {
    try {
      if (disposed) return;
      if (toast && !toast.isConnected) return;
      // 延迟期间设置可能被改过，动手前重新读一次。
      const s = readSettings();
      if (!s.enabled) return;
      if (capReached(s)) {
        const now = Date.now();
        if (now - lastWarnAt > WARN_COOLDOWN_MS) {
          lastWarnAt = now;
          warn('已达连续跳过上限 ' + s.maxConsecutiveSkips + ' 首，收手（可在设置里调整）');
        }
        return;
      }
      if (rateLimited(s)) return;

      if (!toast) {
        advanceQueue('宿主已放弃当前队列');
        return;
      }

      const btn = findSkipButton(toast);
      if (!btn) {
        if (kind === 'countdown') {
          // 倒计时卡上认不出「跳过」就先不动手：原版 5 秒后自己会跳，
          // 而这里盲点第一个按钮会点到「取消」（= 关闭提示卡）。
          warn('倒计时卡上没有可识别的「跳过」按钮，交给原版处理');
          return;
        }
        advanceQueue('提示卡里没有「跳过」按钮');
        return;
      }

      noteSkip();
      const invoked = runSkipHandler(toast, s.skipMode);
      info(
        (invoked ? '已跳过' : '尝试跳过失败') +
          '（' +
          (s.skipMode === 'click' ? '模拟点击' : '直接调用') +
          '，' +
          (kind === 'countdown' ? '原版倒计时' : '暂时无法播放') +
          '，连续 ' +
          consecutiveSkips +
          '）：' +
          text
      );

      // 校验提示卡是否真的消失了；没消失说明这次没生效（例如同一首又被重试），
      // 稍后再扫一次。这里只做观察，不重复调用回调以免误跳两首。
      // 去重交给 noteToastAttempt 的时间窗（SAME_TOAST_COOLDOWN_MS），
      // 所以这里即使重扫也只会被挡下，不会重复出手。
      if (verifyTimer) clearTimeout(verifyTimer);
      verifyTimer = setTimeout(function () {
        verifyTimer = null;
        if (disposed) return;
        if (!toast.isConnected) return;
        scheduleSweep();
      }, CLICK_VERIFY_MS);
    } catch (err) {
      fail('自动跳过时出错', err);
    }
  }

  function scheduleSkip(toast, text, kind, settings) {
    const delay = kind === 'countdown' ? settings.countdownDelayMs : settings.delayMs;
    noteToastAttempt(toast);
    markBusy(delay);
    info(
      '检测到「' +
        text +
        '」（' +
        (kind === 'countdown' ? '原版倒计时' : '暂时无法播放') +
        '），' +
        delay +
        'ms 后跳过（' +
        (settings.skipMode === 'click' ? '模拟点击' : '直接调用') +
        '）'
    );
    setTimeout(function () {
      if (disposed) return;
      performSkip(toast, text, kind);
    }, delay);
  }

  /**
   * 收集候选提示卡。
   * 主路径：React portal 直接挂在 document.body 下，所以先看 body 的元素子节点
   *         （不依赖 Tailwind 的 z-[210] 属性选择器转义）。
   * 兜底：再 querySelectorAll 一遍，兼容将来 portal 容器变化。
   */
  function collectCandidates() {
    const out = [];
    const seen = [];
    const push = function (el) {
      if (!el || el.nodeType !== 1) return;
      if (seen.indexOf(el) !== -1) return;
      seen.push(el);
      out.push(el);
    };

    const body = document.body;
    if (body && body.children) {
      for (let i = 0; i < body.children.length; i += 1) push(body.children[i]);
    }
    try {
      const found = document.querySelectorAll(TOAST_SELECTOR);
      for (let i = 0; i < found.length; i += 1) push(found[i]);
    } catch (err) {
      /* 属性选择器不被支持时，body 子节点已经覆盖了 portal */
    }
    return out;
  }

  /**
   * 宿主放弃检测。原版连跳达到自己的上限（b7 = 2）后会把播放状态打到 IDLE
   * 并停在那里 —— 此时既没有提示卡也没有任何事件，只能靠轮询发现。
   * 只有「刚刚才自动跳过」的窗口内才算放弃，避免把正常播完当成放弃。
   */
  function checkGiveUp(settings) {
    // 每轮都读一次播放状态：它既用于「真的播起来了 → 连续计数归零」，
    // 也用于「宿主放弃 → 继续推队列」。getState() 是同步的，也不需要额外权限。
    const st = playbackState();
    if (st && st.state === 'playing') {
      // 有歌真的播起来了 —— 连续跳过计数归零。
      // 原版只对 taken-down 累加、其它 reason 一律归零；本模组统一改成
      // 「播放成功才归零」，这样 maxConsecutiveSkips 才数得准。
      consecutiveSkips = 0;
      return;
    }

    if (!settings.resumeAfterGiveUp) return;
    if (resumeTimer) return;
    if (!lastSkipAt || Date.now() - lastSkipAt > GIVEUP_WINDOW_MS) return;
    if (capReached(settings)) return;
    if (resumedForSkipAt === lastSkipAt) return;
    if (!st || st.state !== 'stopped') return;

    resumedForSkipAt = lastSkipAt;
    info('宿主已停止（连续失败上限），' + RESUME_DELAY_MS + 'ms 后继续推进队列');
    resumeTimer = setTimeout(function () {
      resumeTimer = null;
      if (disposed) return;
      const s = readSettings();
      if (!s.enabled || !s.resumeAfterGiveUp) return;
      if (capReached(s)) return;
      if (rateLimited(s)) return;
      const now = playbackState();
      if (!now || now.state !== 'stopped') return;
      advanceQueue('宿主已放弃当前队列');
    }, RESUME_DELAY_MS);
  }

  function sweep() {
    if (disposed) return;
    if (typeof document === 'undefined' || !document.body) return;
    const settings = readSettings();
    if (!settings.enabled) return;

    // 状态观察（含「真的播起来了 → 连续计数归零」「宿主放弃 → 继续推进」）
    // 放在忙窗口判断之前：它只读一次播放状态，很便宜，而且被忙窗口挡住会导致
    // 连续计数无法归零、宿主放弃也发现不了。
    checkGiveUp(settings);

    if (Date.now() < pendingUntil) return;
    const nodes = collectCandidates();
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (!shouldHandleToast(el)) continue;
      if (!isToastElement(el)) continue;
      const text = toastMessage(el);
      const kind = classifyToast(text);
      if (!kind) continue;
      if (kind === 'skip-in-progress') continue;
      if (kind === 'countdown' && !settings.handleCountdown) continue;
      scheduleSkip(el, text, kind, settings);
      return;
    }
  }

  function scheduleSweep() {
    if (disposed) return;
    if (debounceTimer) return;
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      sweep();
    }, SWEEP_DEBOUNCE_MS);
  }

  let observer = null;

  function start() {
    if (disposed || typeof document === 'undefined' || !document.body) return;
    try {
      observer = new MutationObserver(function (mutations) {
        // 只在真的插入了元素时才扫描：歌词动画大多是文本节点变化，
        // 这条过滤把扫描频率压到「界面结构变化」的量级。
        for (let i = 0; i < mutations.length; i += 1) {
          const added = mutations[i].addedNodes;
          for (let j = 0; j < added.length; j += 1) {
            if (added[j] && added[j].nodeType === 1) {
              scheduleSweep();
              return;
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } catch (err) {
      fail('无法监听 DOM，退化为轮询', err);
    }

    backstopTimer = setInterval(sweep, BACKSTOP_INTERVAL_MS);
    if (typeof window !== 'undefined' && window.document) {
      info(
        '已启动（跳过方式：' +
          (readSettings().skipMode === 'click' ? '模拟点击' : '直接调用') +
          '，上下文：' +
          ((folium && folium.env && folium.env.context) || '?') +
          '）'
      );
    }
  }

  function dispose() {
    disposed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (backstopTimer) clearInterval(backstopTimer);
    if (verifyTimer) clearTimeout(verifyTimer);
    if (busyTimer) clearTimeout(busyTimer);
    if (resumeTimer) clearTimeout(resumeTimer);
    debounceTimer = null;
    backstopTimer = null;
    verifyTimer = null;
    busyTimer = null;
    resumeTimer = null;
    if (observer) {
      try {
        observer.disconnect();
      } catch (err) {
        /* ignore */
      }
      observer = null;
    }
    recentSkips = [];
    pendingUntil = 0;
  }

  if (typeof document === 'undefined') {
    warn('没有 document，本模组只在渲染进程中工作');
  } else if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  return dispose;
}
