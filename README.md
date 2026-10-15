# Auto skip

Folia 的播放失败提示有个缺口：歌下架了它自己会倒计时跳过，但音源暂时取不到的时候，它只是停下来弹一张「跳过 / 重试」的卡片，然后一直等你点。

播到这种歌就卡在那儿，挺烦的，所以写了个模组补上，顺手把原版那个写死的倒计时也改成可配置的。

## 是哪个缺口

Folia 内部有一张按失败原因分发的策略表。绝大多数情况宿主自己会处理，只有两行的 `autoSkip` 是 `none`：

| failure.reason | 提示文案 | autoSkip |
|---|---|---|
| `invalid-response` | 暂时无法播放这首歌 | `none` |
| `unknown` | 暂时无法播放这首歌 | `none` |
| `taken-down`（对照） | 歌曲已下架，N 秒后自动跳过 | `countdown` |

前两行的 `stopPlayback` 是 `true`，所以它会暂停播放、弹出常驻卡片，然后等你手动点。

酷狗那边取不到 URL 时抛的是 `not-playable`，这个 code 在分类器里归到 `unknown`，正好落在这两行上。于是「明明是音源的问题，却要人手点」就发生了。

## 怎么做的

Folium 1.4 没有播放失败事件，也没有拦截 toast 的钩子。提示卡的数据是 bootstrap 里一个 React `useState`，连 `internals` 暴露的 zustand store 里都没有它。能下手的只有提示卡的 DOM。

拿到卡片之后，触发跳过有两个办法：

- **直接调用**（默认）—— 宿主的 `skip` 回调就挂在按钮的 React props 上，读出来直接调。不派发 DOM 事件，也就没有「事件没被接住」这种失败可能。
- **模拟点击** —— 对按钮派发真实 click，交给 React 的委托监听器。

两个都走宿主自己的 `skip`，所以队列推进和 `unavailableSkipCount` 的行为跟手点是一样的。自己调 `playback.next()` 只在认不出按钮时兜底，因为它在队列为空或 stage 模式下是空操作。

React 属性名是 `__reactProps$` 加一串随机字符，`readClickHandler()` 负责找。哪天读不到了会自动退回点击，不会默默什么都不做。

## 原版倒计时现在可调

原版这块是写死的：倒计时 5 秒，连续跳 2 首就放弃（把播放器置成 IDLE 停住）。现在：

- `handleCountdown` 决定要不要接管「下架 / 播放出错」这两族倒计时卡片；`countdownDelayMs` 是接管后的延迟，默认 0，也就是立刻跳，不用等那 5 秒。
- `maxConsecutiveSkips` 取代原来写死的 2，默认 0 表示不限。
- `resumeAfterGiveUp` 打开时，宿主放弃之后会自动往前推一首，而不是停在那里。

连续计数在下一首真的播起来之后归零，判断靠 `playback.getState()` 的 state。

## 几个刻意没做的事

- **不点第一个按钮。** mid-playback 场景下宿主可能拿不到 skip 回调，这时卡片渲染成 `[取消][重试]`，而取消只是关掉提示。代码只认文字是「跳过 / Skip / Lewati」的按钮，或者「有重试按钮 + 另有唯一一个既不是重试也不是取消的按钮」这个推断，否则返回 `null` 走 `playback.next()`。宁可不跳，也不点到取消。
- **不碰别的文案。** 网络失败、超时、会员和版权那几类不管；「正在跳过」这种没有按钮的信息卡也不管。倒计时文案单独分类，只有 `handleCountdown` 开着才接管。
- **同一张卡不重复出手。** React 拿 `type:text:nonce` 当 key，连续两首同样的文案会复用同一个 DOM 节点。所以去重是按时间窗做的，不是永久记住 —— 永久记住的话第二首就漏了。另外有单节点的出手次数上限。
- 调完回调只看卡片有没有消失，不重复调，免得一跳两首。

## 设置

选项 → 模组 → Auto skip。

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

## 装

1. 把 `mod.json` 和 `client.mjs` 放进 `%APPDATA%\Folia\mods\auto-skip\`
2. 选项 → 模组 → 重载（或者直接重启 Folia）
3. 第一次会让你确认一次，信任是绑在内容摘要上的

**改任何文件都会让确认失效，要重新点一次。** 这是宿主故意的，防止批准过的代码被换掉。

`mod.json` 里写了 `"folia": ">=0.7.0 <0.8.0"`。升到 0.8 之后会直接报 `host-version-mismatch`，因为这些 DOM 特征是按 0.7.19 写的，报错比「装了没反应」好查。

## 仓库里的东西

安装只需要 `mod.json` 和 `client.mjs`。

`variants/` 下是两个单策略版本，从 `client.mjs` 生成（锁掉 `skipMode` 并忽略设置项里的选择），想固定用一种行为就把对应的拷过去当 `client.mjs` 用。

`tests/` 里是测试：

```
node tests/texts.test.mjs        文案分类和按钮识别，带反例
node tests/integration.test.mjs  拿极简 DOM 替身跑 activate()，21 项
node tests/variants.test.mjs     三个文件的策略行为
node tests/manifest.test.mjs     用宿主自己的 manifest.cjs 校 mod.json
node tests/digest.test.mjs       复算内容摘要
```

后两个用的是 Folia 自带的模块，它们在 `app.asar` 里，需要先解包一次：

```
npx asar extract "C:\Other\Folia\resources\app.asar" .\_folia_re\asar
$env:FOLIA_MODSYSTEM_DIR = ".\_folia_re\asar\electron\modSystem"
```

找不到宿主模块时这两个会打印 `SKIP` 并以 0 退出，不会因为没装 Folia 就跑不起来。

顺带一提，**别把 `variants/` 或 `tests/` 拷进安装目录** —— 摘要对目录里每一个文件都算，多一个文件摘要就变了，确认会失效。

## 权限

只声明 `playback.control`，用于 `playback.next()` 兜底和读播放状态判断有没有真的播起来。不联网，不读写文件。

MIT。

---

*English note: a Folium client mod for Folia 0.7.x. Folia's failure policy gives `invalid-response` and `unknown` a persistent retry/skip card with `autoSkip: 'none'`, so playback stops and waits for a click; only `taken-down` gets the built-in 5-second countdown. This mod skips the former and makes the countdown (delay and consecutive-skip cap) configurable. Folia exposes no playback-failure event or toast hook, so it works off the toast DOM and invokes the host's own skip callback directly (default) or via a real click. Tested against Folia 0.7.19.*
