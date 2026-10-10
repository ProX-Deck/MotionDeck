---
name: card-spec-generator
description: 动效卡片生成——新建 MotionDeck 的「在线卡片(外置卡)」:往 `data/cards/` 丢一张 `EffectSpec` JSON(命令式另加 `.hook.mjs`),刷新页面即生效,全程只操作运行时目录。触发词:新建动效卡片、加一张在线卡、把某某效果做成卡。
---

<!--
本 skill 描述 MotionDeck 的**真实**在线卡片(外置卡)机制,以运行时行为为唯一事实来源
(见【先读真实契约】)。

**在线卡(运行时加载,本 skill 唯一覆盖的路径)**:
`data/cards/<id>.json`(一张卡一个 `EffectSpec` 文件),由工作台服务端的
`GET /api/cards` 下发,效果库加载并合成后,由「声明式模板」或「命令式钩子」渲染。
**刷新页面即生效,不需要任何构建步骤**,也能正常导出。它只有「模板」和「钩子」两种渲染
方式,且**不进仓库**(只在本机运行时目录),换机器要手动带走。

> ⚠️ 两类卡做不成在线卡,本 skill 不覆盖:
> - **运镜·相机**:运动不在模板/钩子里,在线卡接不进这条链路;
> - **网页截图**:依赖内置的网页截图脚手架,在线卡引用不到。
> 这两类只能以「内置卡」形式提供(由维护方走另一条路径),不属于本 skill 的在线卡范畴。
-->

# 动效卡片生成:新建一张在线卡(外置卡)

把「一张动效卡片长什么样、怎么动」写成 **`data/cards/` 下的一个 `EffectSpec` JSON**,
命令式卡再加一个 `<id>.hook.mjs`。**不用构建、不用登记,刷新页面就出现在效果库「本地卡片」分组**。

## 先读真实契约(唯一事实来源)

不要凭记忆写,先读这两处:
1. 本仓库 `README.md` 的「四、卡片系统 › 外置卡片详解(`data/cards/`)」一节 —— 在线卡
   `EffectSpec` 的字段、模板语法、钩子签名、护栏规则。
2. `data/cards/` 下**已有的**一张卡 JSON(照猫画虎最快);目录用法与限制见同目录说明。

> 本 skill 全程只操作 `data/cards/` 这个运行时目录,不涉及任何其它工程目录。

## 开工与收工(固定动作)

- **产物落 `data/cards/`**,每张卡 = `<kebab-id>.json`;命令式卡同目录再加 `<kebab-id>.hook.mjs`。
  **禁止写项目 `tmp/`**,也不要把生成脚本落盘(直接用本对话的推理产出文件)。
- **命名不与已有卡冲突**:`id` 不要和 `data/cards/` 下已有的卡、以及效果库内置卡 `id` 重名,
  除非你**有意覆盖**某张卡(同名会覆盖前者)。
- **收工做契约自检(见【自检】):** 刷新页面,效果库出现这张卡、改 JSON 再刷新即变。
  **在线卡刷新即生效,不要声称"要构建"** —— 那是错的,只有内置卡才需要构建步骤。
- **不擅自 commit / push**:按项目铁律,只把文件写好并报告;除非用户明确说「commit」。
  (`data/cards/` 本就不进仓库,换机器要手动拷。)

## 字段(`EffectSpec`)

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | kebab-case;编排 JSON 里的 `kind` 就是它;不要撞内置卡 id(撞了会覆盖同名内置卡) |
| `name` / `description` | ✅ | 展示名 / 一句话用途 |
| `defaults` | ✅ | 参数默认值,与 `controls[].key` 一一对应 |
| `controls` | ✅ | `Control`(range/text/textarea/select/toggle/color/media) |
| `render` | ✅ | 见下:声明式(`declarative`)或命令式(`hook`) |
| `vTier` / `selfPosition` / `tags` | ⬜ | 与内置卡同义,都会生效 |
| `form` | ⬜ | `"hud"`(默认)/ `"cam"` / `"webspot"` —— 后两个会被护栏拦下,别写 |
| `group` | ⬜ | 预留;当前不参与分组(在线卡统一进「本地卡片」组) |

## 参数与控件(controls)

`controls` 沿用统一的 `Control` 联合类型(与参数面板一一对应):

| type | 用途 | 关键子字段 |
|---|---|---|
| `range` | 数值滑杆 | `min` / `max` / `step` / `unit?` |
| `text` | 单行文本 | — |
| `textarea` | 多行文本(支持 `\|` / `/` 分隔的条目或坐标) | `rows?` / `help?`(折叠语法速查) |
| `select` | 下拉 | `options: {label,value}[]` |
| `toggle` | 开关 | — |
| `color` | 颜色 | — |
| `media` | **媒体位**:图片/视频/网页截图。参数面板渲染文件选择器(上传到运行时媒体目录,返回 `/demo/<name>` 这种 URL 字符串,与 `camSrc`/`src` 同契约);**无「网页截图」自动采集按钮**(截图由用户上传或 agent 落盘提供) | `accept?` / `noun?` / `advanced?` |

## 竖版让位 / 落位 / 主题

- `vTier`(`still`/`half`/`full`):只在 9:16 竖版生效,决定口播人像退到哪;横版忽略。
  同屏多张卡取最重一档(`full > half > still`)。
- 落位:声明式模板里用 `position` 参数 + 根节点 class 表达左右槽/居中;HUD 族(`selfPosition:true`)
  自己用绝对定位,不进槽。
- 主题底色:`theme` 参数(dark/light),模板里用 `data-card-theme` 或 `hud-glass--*` 类承接。

## 视觉标签(tags)

`tags` 描述「这张卡看起来怎么动」,可多个,用于效果库内的语义检索。新增卡**建议带上贴切的
标签**,让语义检索能命中(例如运镜感带 `["推近定格"]`、聚光灯带 `["扫过点亮","取景重构"]`、
倒计时带 `["弧排数字","盘旋落定"]`)。

## 渲染方式

### 声明式(`render.type: "declarative"`)—— 够用就用它

- `template`:HTML 字符串。`{{param}}` 插值(**值会做 HTML 转义**);
  另有 `{{#each 数组参数}}…{{/each}}`、`{{#if 参数}}…{{else}}…{{/if}}`,循环内 `{{@index}}`。
- `style`:CSS 字符串,按卡 id 注入一次。
- 根节点固定 `<div class="spec-card-root card-<id>">`:每次播放先移除再加 **`.is-playing`**
  (用来重启 CSS 动画),并持续在根节点上写 **`--t`**(自播放起的毫秒)。

```css
/* 动画就这么挂:.is-playing 触发,forwards 收尾 */
.card-my-card .box { opacity: 0; }
.card-my-card.is-playing .box { animation: my-in .6s ease-out forwards; }
```

### 命令式(`render.type: "hook"`)—— 模板表达不了才用

同目录写 `<id>.hook.mjs`,服务以 `GET /api/cards/<id>/code.js` 提供(也可把代码塞进
`render.code` 内联,但那不好改)。模块导出 `render(node, ctx)`,可返回 cleanup:

```js
export function render(node, { params, time, playToken, vars }) {
  node.innerHTML = `<div class="box">${params.text}</div>`;
  let raf = 0;
  const tick = () => { node.style.opacity = Math.min(1, time() / 400); raf = requestAnimationFrame(tick); };
  tick();
  return () => cancelAnimationFrame(raf);
}
```

⚠️ 时间**只能**用 `ctx.time()`(或 CSS 的 `--t`),**不要用 `performance.now()` 自己算起点** ——
导出时页面跑在虚拟时钟下,自己算会和内置卡错帧。

## 最小样例

```json
{
  "id": "online-demo-pill",
  "name": "示例·在线胶囊条",
  "description": "胶囊底 + 文字上浮淡入",
  "form": "hud",
  "vTier": "still",
  "defaults": { "text": "这里换成你的文案", "accent": "#5fa0fa" },
  "controls": [
    { "key": "text", "label": "文字", "type": "text" },
    { "key": "accent", "label": "胶囊底色", "type": "color" }
  ],
  "render": {
    "type": "declarative",
    "template": "<div class=\"odp\" style=\"--c: {{accent}}\">{{text}}</div>",
    "style": ".card-online-demo-pill .odp{display:inline-block;padding:12px 22px;border-radius:999px;background:var(--c);color:#fff;font-size:34px;opacity:0;transform:translateY(16px)}.card-online-demo-pill.is-playing .odp{animation:odp-in .62s cubic-bezier(.16,1,.3,1) forwards}@keyframes odp-in{to{opacity:1;transform:none}}"
  }
}
```
(可参考 `data/cards/` 下已有的卡 JSON;目录用法与限制见同目录说明。)

## 链路(都已打通,不要再造轮子)

`data/cards/*.json` → 服务端 `GET /api/cards` → 效果库加载合成 → 「声明式模板」/
「命令式钩子」渲染。导出端同样会先加载这个目录,**在线卡能正常导出**。

编排里引用它:`kind` 写这个 `id`,和内置卡没区别。效果库顶部出现红字提示 = 被护栏判定
「做不成在线卡」(运镜/截图类),按提示换思路(这两类本 skill 不覆盖)。

## 自检(交付前必跑)

- **刷新页面**:效果库出现「本地卡片」分组、卡在里面;改 JSON 再刷新即变。
- **controls 与 defaults 一致**:每个 `controls[].key` 都在 `defaults` 里有值,反之亦然。
- **id 唯一**:`id` 不与 `data/cards/` 下其他卡、以及内置卡 `id` 重复(重名会静默覆盖)。
- **kind 可被编排引用**:确认 `id` 就是 overlay JSON 里要写的 `kind`。

## 与「特效生成」skill 的区别

- `overlay-generator`:产出 **overlay JSON**(一份视频里「用哪些已有卡、怎么编排」)—— 数据/编排层。
- 本 skill:产出 **EffectSpec**(「一张卡本身长什么样、怎么动」)—— 卡片类型层。
  本 skill 在 `data/cards/` 里定义一张在线卡(刷新即被效果库识别),前者即可在编排里引用这个 `kind`。
