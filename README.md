# 全程由AI生成

## Auto skip

Folia 的播放失败：歌下架了它自己会倒计时跳过，但音源暂时取不到的时候，它只是停下来弹一张「跳过 / 重试」的卡片，然后一直等你点。

听到这种歌就卡在那，所以写了个模组补上。

Folia 内部有按失败原因分发的策略表。绝大多数情况宿主自己会处理，有两行的 `autoSkip` 是 `none`：

| failure.reason | 提示 | autoSkip |
|---|---|---|
| `invalid-response` | 暂时无法播放这首歌 | `none` |
| `unknown` | 暂时无法播放这首歌 | `none` |
| `taken-down`（对照） | 歌曲已下架，N 秒后自动跳过 | `countdown` |

前两行的 `stopPlayback` 是 `true`，所以它会暂停播放、弹出常驻卡片，然后等你手动点。

酷狗那边取不到 URL 时抛的是 `not-playable`，这个 code 在分类器里归到 `unknown`，正好落在这两行上。于是「明明是音源的问题，却要手动跳过」就发生了。

### 怎么做到的

Folium 1.4 没有播放失败事件，也没有拦截 toast 的钩子。提示卡的数据是 bootstrap 里一个 React `useState`，连 `internals` 暴露的 zustand store 里都没有它。能下手的只有提示卡的 DOM。

拿到卡片之后，触发跳过有两个办法：

- **直接调用**（默认）—— 宿主的 `skip` 回调就挂在按钮的 React props 上，读出来直接调。不派发 DOM 事件，也就没有「事件没被接住」这种失败可能。
- **模拟点击** —— 对按钮派发真实 click，交给 React 的委托监听器。

两个都走宿主自己的 `skip`，所以队列推进和 `unavailableSkipCount` 的行为跟手点是一样的。自己调 `playback.next()` 只在认不出按钮时兜底，因为它在队列为空或 stage 模式下是空操作。

React 属性名是 `__reactProps$` 加一串随机字符，`readClickHandler()` 负责找。哪天读不到了会自动退回点击，不会默默什么都不做。

### 功能

| key | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `skipMode` | `direct` | `direct` 直接调用 / `click` 模拟点击 |
| `delayMs` | `250` | 「暂时无法播放」卡片的延迟，0–5000 |
| `handleCountdown` | `true` | 是否接管原版倒计时 |
| `countdownDelayMs` | `0` | 倒计时卡片的延迟，0–5000 |
| `maxSkipsPerMinute` | `8` | 一分钟最多跳几次 |
| `maxConsecutiveSkips` | `0` | 连续跳过上限，0 不限（原版是 2） |
| `resumeAfterGiveUp` | `true` | 宿主放弃后自动推一首 |

`maxConsecutiveSkips` 管连续几首就停手，`maxSkipsPerMinute` 管出手频率，防的是整张歌单全挂的时候疯狂连跳。

### 安装

1. 把 `mod.json` 和 `client.mjs` 放进 `%APPDATA%\Folia\mods\auto-skip\`
2. 选项 → 模组 → 重载（或者直接重启 Folia）

MIT。

---

*English note: a Folium client mod for Folia 0.7.x. Folia's failure policy gives `invalid-response` and `unknown` a persistent retry/skip card with `autoSkip: 'none'`, so playback stops and waits for a click; only `taken-down` gets the built-in 5-second countdown. This mod skips the former and makes the countdown (delay and consecutive-skip cap) configurable. Folia exposes no playback-failure event or toast hook, so it works off the toast DOM and invokes the host's own skip callback directly (default) or via a real click. Tested against Folia 0.7.19.*
