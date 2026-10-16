# 本项目全程由deepseek代管

## Auto skip

Folia 0.7.20 加了个「无法播放时自动跳过」开关，默认关着；打开之后会员、地区、下架、原因不明这几类会倒计时跳过。但它按设计不碰两种：需要登录的歌，和网络问题。碰上了就停下来弹张卡片，一直等人点。

听到这种歌就卡在那，所以写了个模组补上，顺手把原版写死的倒计时和连跳上限也变成可调的。

Folia 内部有按失败原因分发的策略表。原版那个开关做的事，是把下面几行的 `autoSkip` 从 `none` 改成 `countdown`：

| failure.reason | 提示 | 开关关 | 开关开 |
|---|---|---|---|
| `membership-required` `purchase-required` `region-restricted` 等 | 会员 / 购买 / 地区… | `none` | `countdown` |
| `invalid-response` `unknown` | 暂时无法播放这首歌 | `none` | `countdown` |
| `taken-down` | 歌曲已下架，N 秒后自动跳过 | `countdown` | `countdown` |
| `not-signed-in` `session-expired` | 请先登录 | `none` | `none` |
| `network` `timeout` `rate-limited` | 网络失败 / 超时 | `none` | `none` |

最后两行是硬编码的「永不跳过」—— 卡片上只有一个 `skip` action，渲染出来是 `[取消][跳过]`，然后一直等你点。这个模组接的就是这两行。

酷狗那边取不到 URL 时抛的是 `not-playable`，这个 code 在分类器里归到 `unknown`，正好落在上面第二行。

### 怎么做到的

Folium 1.5 有 `playback.failed` 事件，这是正路。事件带 `reason`（`auth` / `restricted` / `taken-down` / `network` / `unknown` 五类）和 `willAutoSkip`：

- `willAutoSkip: true` 表示宿主正在倒计时，那就别动 —— 自己去跳会跟原版抢，可能一跳两首。
- `false` 才是原版管不了的那些，模组按设置决定接不接。

事件是同步派发的，但宿主是先建提示卡、再发事件，所以事件到达时卡片还没进 DOM。模组靠 `delayMs`（默认 250ms）留出这个时间差，然后走「调用卡片按钮」这条最稳的路径。

拿到卡片之后，触发跳过有两个办法：

- **直接调用**（默认）—— 宿主的 `skip` 回调就挂在按钮的 React props 上，读出来直接调。不派发 DOM 事件，也就没有「事件没被接住」这种失败可能。
- **模拟点击** —— 对按钮派发真实 click，交给 React 的委托监听器。

两个都走宿主自己的 `skip`，所以队列推进的行为跟手点一样。认不出卡片时才退回 `playback.next()`，因为它在队列为空或 stage 模式下是空操作。

**只认文字，不认位置。** 这点很要命：两张卡的按钮槽位是反的。「暂时无法播放」那张（`actions: ['retry','skip']`）里「跳过」在 cancel 槽、「重试」在 action 槽；倒计时那张里「跳过」才是 action 槽。而且只有单个 action 时，cancel 槽会退化成「取消」+ `dismiss` —— 那种卡盲点第一个按钮就是静默关掉提示，歌一动不动。所以代码只认文字是「跳过 / Skip / Lewati」的按钮，否则返回 `null`。宁可不跳，也不点到取消。

### 功能

| key | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `skipUnplayable` | `true` | 会员 / 地区 / 下架 / 原因不明那批 |
| `skipAuthNetwork` | `false` | 登录类和网络类也跳 |
| `delayMs` | `250` | 看到失败卡后等多久，0–5000 |
| `hideToast` | `true` | 关掉提示卡显示 |
| `countdownSeconds` | `0` | 先弹自己的倒数卡，0–10，0 为不弹 |
| `handleCountdown` | `false` | 接管原版倒计时，不等满 5 秒 |
| `skipMode` | `direct` | `direct` 直接调用 / `click` 模拟点击 |
| `maxSkipsPerMinute` | `8` | 一分钟最多跳几次 |
| `maxConsecutiveSkips` | `0` | 连续跳过上限，0 不限（原版是 2） |
| `resumeAfterGiveUp` | `true` | 宿主放弃后自动推一首 |
| `injectPanel` | `true` | 在原版设置项下方插快捷开关 |

后四个是保险丝：`maxConsecutiveSkips` 管连续几首就停手，`maxSkipsPerMinute` 管出手频率，防的是整张歌单全挂的时候疯狂连跳。`hideToast` 只在确实会跳的时候才藏卡片，不会跳的情况卡片照常显示，不然你会看着歌停了、什么提示都没有。

设置分两处：选项 → 模组 → Auto skip（官方接口）；以及选项 → 播放控制 → 「无法播放时自动跳过」下方那排快捷开关（DOM 注入，`injectPanel` 可关）。

### 安装

1. 把 `mod.json` 和 `client.mjs` 放进 `%APPDATA%\Folia\mods\auto-skip\`
2. 选项 → 模组 → 重载（或者直接重启 Folia）
3. 第一次会让你确认一次，信任是绑在内容摘要上的

**改任何文件都会让确认失效，要重新点一次。** 这是宿主故意的，防止批准过的代码被换掉。

`mod.json` 里写了 `"folia": ">=0.7.20 <0.8.0"`。底部是 0.7.20 因为 `playback.failed` 是这一版才有的；上限是 0.8，因为 DOM 注入那部分是按 0.7.20 的结构写的，报 `host-version-mismatch` 比「装了没反应」好查。

安装只需要 `mod.json` 和 `client.mjs`，**别把 `variants/`、`tests/`、`tools/` 拷进去** —— 摘要对目录里每一个文件都算，多一个文件摘要就变了。

MIT。

---

*English note: a Folium client mod for Folia 0.7.20. Stock Folia's "skip unplayable songs" setting moves membership, region, taken-down and unknown failures to a countdown, but sign-in and network failures stay hard-coded to never skip — the card just sits there. This mod takes those over, and makes the countdown delay and consecutive-skip cap configurable. It listens to `playback.failed`, respects `willAutoSkip` so it never races the host's own countdown, and claims skip by button label rather than position (the two card kinds put skip in opposite slots). The quick-switch row under the stock setting is DOM-injected, since Folium's `settingsSections` only renders in the mods panel.*
