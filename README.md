# Auto skip — Folia 自动跳过模组（Folium）

**出现「暂时无法播放这首歌」时自动跳过，并把原版的「下架 / 播放出错」倒计时一并接管成可配置。**

一个 [Folium](https://github.com/) 客户端模组，适用于 Folia 0.7.x。

> English: a Folium client mod for Folia. It auto-skips the persistent
> "Can't play this song right now" card (which stock Folia never auto-skips),
> and takes over stock's built-in countdown skipping so the delay and the
> consecutive-skip cap become configurable. See [English summary](#english-summary).

---

## 它解决什么

Folia 内置的播放失败策略表里，绝大多数失败宿主自己会处理。**只有两类不会自动跳过**：

| failure.reason | messageKey | autoSkip | actions |
|---|---|---|---|
| `invalid-response` | `status.songTemporarilyUnavailable` | `none` | `retry`, `skip` |
| `unknown` | `status.songTemporarilyUnavailable` | `none` | `retry`, `skip` |
| `taken-down`（对照） | `status.songUnavailable` | **`countdown`** | — |

也就是说：歌曲**下架**时宿主自己会倒计时 5 秒后跳过；但**「暂时无法播放」**这一类
`autoSkip` 是 `none`、`stopPlayback` 是 `true`，宿主只会弹一张常驻卡片——
**停止播放并一直等你手动点**。

实际日志里的典型触发链：

```
[OnlinePlayback] Provider audio source is temporarily unavailable
  → All kugou playback attempts failed (not-playable)
  → provider code not-playable
  → 分类器 Hie() 的 case 'not-playable' 返回 unknown
  → 命中上表第二行 → 常驻「跳过 / 重试」卡片
```

（`not-playable` / `unsupported` / `not-public` 都映射到 `unknown`。）

## 为什么走 DOM 而不是官方 API

Folium 1.4 对外只有 `playback.beforePlay` 与 `lyrics.transform` 两个 hook，以及
`playback.songChanged | stateChanged | seeked | likeChanged`、`lyrics.loaded`、
`theme.changed`、`app.viewChanged`、`visualizer.modeChanged` 这些事件。

**没有「播放失败」事件，也没有 toast 拦截钩子。** 提示卡的 model 是 bootstrap 组件里的
React `useState`，连 `internals` 暴露的 zustand playback store 里都没有 `statusMsg`。
所以唯一精确的观测点就是提示卡本身的 DOM。

## 两种跳过方式（都保留，可切换）

| 方式 | 做法 | 说明 |
|---|---|---|
| **直接调用**（默认） | 取出宿主挂在按钮上的 React `onClick`（就是宿主的 `skip` 回调）并**直接调用** | 不派发任何 DOM 事件，不存在「合成事件没接住」这种失败模式 |
| **模拟点击** | 对该按钮派发真实 `click`，由 React 的委托监听器接住 | 老行为，保留作兜底与对照 |

两者都**走宿主自己的 `skip` 回调**，所以队列推进、`unavailableSkipCount` 等语义与
用户手点**完全一致**；比自己去调 `playback.next()` 安全得多（后者在队列为空或
stage 模式激活时是 no-op，仅作最后兜底）。

「直接调用」靠 React 的 `__reactProps$<random>` 属性（`readClickHandler()`）把回调取出来。
读不到时（宿主换 React 版本、或用了非标准 handler）会自动退回 DOM 点击，不会静默失效。

## 全面接管原版倒计时

原版的自动跳过是硬编码的：倒计时 `5000ms`、连续跳过上限 `2`、超过就
`setPlayerState(IDLE)` 放弃。本模组把它变成可配置：

- **`handleCountdown`**（默认开）— 接管「歌曲已下架」与「播放出错」这两族倒计时卡片。
  默认延迟 `countdownDelayMs = 0`，即立刻跳过（原版要等 5 秒）。
- **`maxConsecutiveSkips`**（默认 `0` = 不限）— 取代原版硬编码的 `2`。
  连续跳过达到上限后不再自动跳，避免整张歌单失效时无限连跳。
  计数在**下一次真正播起来**（`playback.state === 'playing'`）时归零。
- **`resumeAfterGiveUp`**（默认开）— 宿主放弃后（把播放器置为 IDLE）自动推进队列一次，
  而不是就停在那里。

> 与限流的区别：`maxConsecutiveSkips` 管「连续跳过多少首就停手」（取代原版的 2），
> `maxSkipsPerMinute` 管「一分钟内的出手频率」（防雪崩）。两者互补，默认都不改变原版的正常观感。

## 安全设计

- **绝不闭眼点第一个按钮。** 宿主在 mid-playback 场景可能拿不到 skip 回调，
  此时卡片会渲染成 `[取消][重试]`（取消 = dismiss）。代码只认三种目标：
  1. 文字命中 `跳过 / Skip / Lewati`；
  2. 有「重试」按钮 + 另有唯一一个既非重试也非取消的按钮（槽位推断，兼容未知语言包）；
  3. 否则一律返回 `null`，改用 `playback.next()` 兜底 —— **永远不会点到「取消」**。
- **不误判文案族。** 网络失败、超时、会员/版权类提示都不动；
  「正在跳过」这种纯信息卡也不动（它没有按钮，点了也没用）。
  倒计时文案（含 `自动跳过 / Auto-skipping / otomatis`）单独分类，只在 `handleCountdown` 开启时接管。
- **同一张卡不会连环出手。** React 用 `toastKey = ${type}:${text}:${nonce??0}` 作为 key，
  连续两次同样文案的失败会**复用同一个 DOM 节点** —— 所以去重是按时间窗
  （`SAME_TOAST_COOLDOWN_MS`）而不是永久，否则第二首就漏了；同时有单节点出手上限
  （`MAX_ATTEMPTS_PER_TOAST`）防死循环。
- **兜底不误跳。** 调用回调后只**观察**卡片是否消失，不重复调用，避免一跳两首。
- **可关闭。** 选项 → 模组 → 本模组，有总开关和全部参数。

## 设置项

选项 → 模组 → **Auto skip**

| key | 类型 | 默认 | 范围 | 说明 |
|---|---|---|---|---|
| `enabled` | boolean | `true` | — | 总开关 |
| `skipMode` | select | `direct` | `direct` / `click` | 跳过方式 |
| `delayMs` | number | `250` | 0–5000，步进 50 | 「暂时无法播放」卡片的延迟 |
| `handleCountdown` | boolean | `true` | — | 接管原版倒计时卡片 |
| `countdownDelayMs` | number | `0` | 0–5000，步进 50 | 倒计时卡片的接管延迟 |
| `maxSkipsPerMinute` | number | `8` | 1–60 | 限流（防雪崩） |
| `maxConsecutiveSkips` | number | `0` | 0–50 | 连续跳过上限，`0` = 不限（原版为 2） |
| `resumeAfterGiveUp` | boolean | `true` | — | 宿主放弃后自动推进队列 |

## 文件

| 文件 | 说明 |
|---|---|
| `mod.json` | Folium 清单（`folium: 1`，id `auto-skip`，name `Auto skip`） |
| `client.mjs` | 客户端入口（**安装用**），`export default function activate(folium)`，双策略可切换 |
| `variants/client.direct-only.mjs` | 单策略锁定版：只直接调用回调 |
| `variants/client.click-only.mjs` | 单策略锁定版：只模拟点击 |
| `tests/texts.test.mjs` | 文案分类与按钮识别的单元测试（含反例） |
| `tests/integration.test.mjs` | 用极简 DOM 替身驱动 `activate()` 的集成测试（21 项） |
| `tests/variants.test.mjs` | 三个文件（双策略 + 两个锁定版）逐一的策略行为测试 |
| `tests/manifest.test.mjs` | 用宿主自己的 `manifest.cjs` 校验 `mod.json` |
| `tests/digest.test.mjs` | 用宿主自己的 `modDigest.cjs` 复算内容摘要 |

**安装到 Folia 的只有 `mod.json` 和 `client.mjs`。** `variants/` 与 `tests/`
**不要**拷进安装目录 —— 宿主的内容摘要是对目录下**每一个文件**做哈希的，
多一个文件摘要就变了，已批准的信任会失效。

`variants/` 由 `client.mjs` 派生（锁定默认值并忽略设置项里的选择），两者不会各自漂移。

### 测试

```powershell
node tests/texts.test.mjs
node tests/integration.test.mjs
node tests/variants.test.mjs
node tests/manifest.test.mjs          # 需要解包出的宿主模块，否则 SKIP
node tests/digest.test.mjs            # 同上；可传安装目录作参数
```

`manifest.test.mjs` / `digest.test.mjs` 用的是 **Folia 自带的模块**
（`electron/modSystem/manifest.cjs`、`modDigest.cjs`），它们在 `app.asar` 里，
所以需要用 [asar](https://github.com/electron/asar) 之类的工具解包一次：

```powershell
npx asar extract "C:\Other\Folia\resources\app.asar" .\_folia_re\asar
$env:FOLIA_MODSYSTEM_DIR = ".\_folia_re\asar\electron\modSystem"
node tests/manifest.test.mjs
```

找不到宿主模块时这两个测试会打印 `SKIP` 并以 0 退出，不会因为没装 Folia 就跑不起来。

## 安装

1. 把 `mod.json` 和 `client.mjs` 拷到
   `%APPDATA%\Folia\mods\auto-skip\`
2. 选项 → 模组 → **重载**（或重启 Folia）
3. 首次运行需要在确认对话框里**批准**（信任绑定到内容摘要）

> **任何文件改动都会让已批准的信任失效，需要重新确认一次。**
> 这是宿主的设计（防止你批准过的代码被悄悄替换），不是 bug。

`mod.json` 声明了 `"folia": ">=0.7.0 <0.8.0"`。若 Folia 升到 0.8+，模组会显式报
`host-version-mismatch` 而不是静默失效 —— 提示卡的 DOM 标记是照着 0.7.19 写的，
显式报错比「装了但没反应」更好排查。

想换回单策略版本：把对应 `variants/client.<mode>-only.mjs` 拷成安装目录里的
`client.mjs`，重新在模组面板确认一次即可。

## 权限

只声明 `playback.control`（用于 `playback.next()` 兜底、以及读取播放状态判断
「是否真的播起来了」）。不联网、不读写任意文件、不注册任何可视化组件。

---

## English summary

A **Folium client mod for Folia 0.7.x** that fixes one specific gap and makes one
hardcoded behaviour configurable.

**The gap:** in Folia's playback-failure policy table, `invalid-response` and
`unknown` map to `status.songTemporarilyUnavailable` with `autoSkip: 'none'` and
`stopPlayback: true`. The app therefore stops playback and shows a persistent
"Skip / Retry" card that **waits for the user forever**. Only `taken-down` gets
the built-in 5-second countdown. This mod auto-skips the former.

**The takeover:** stock's countdown skipping (5 s, max 2 consecutive skips, then
give up by setting the player to IDLE) becomes configurable — delay, consecutive
cap, and whether to resume the queue after the host gives up.

**How:** Folia exposes no playback-failure event and no toast hook, and the toast
model lives in component `useState` (not in the zustand store), so the toast DOM
is the only precise observation point. The mod reads the host's own `skip`
callback off the button via React's `__reactProps$<random>` property and invokes
it directly (default), falling back to a real `click` (selectable), and finally to
`playback.next()` when no skip button can be identified. It never clicks
blindly — a single-action card renders `[Cancel][Retry]`, where Cancel is a
dismiss, so blind-clicking the first button would silently swallow the toast.

Tested against Folia 0.7.19. Licensed MIT.
