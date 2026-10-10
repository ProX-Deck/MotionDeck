# MotionDeck 动效工作台

MotionDeck 是一条「口播视频动效卡叠加」生产线：**动效卡提前做好、调好、逐帧验过躺在库里；AI 读字幕决定哪句话配哪张卡、几点进出（不写动效代码）；预览台直接看效果调参；导出透明 MOV 整层盖回剪映。**

本系统随包内置了两套 **AI 技能**（在 `skills/` 目录），可装载进任意 Agent 框架（WorkBuddy / Claude / Copilot 等）帮你自动完成「编排」和「加卡」两步——你只管给素材，繁琐的工程活交给 AI。

> - **免费**：个人学习、研究、技术评测、教学等非商业用途，可自由下载、使用、修改并作非商业再分发（须完整保留本声明与版权信息）。
> - **需授权**：任何商业用途——商业产品或服务中集成、对外提供付费服务、商业性再分发等——须事先取得著作权人的**书面授权**。
> - **范围**：本仓库全部内容，含 `MotionDeck/`与 `skills/`。
> - **第三方组件**：React / Vite / Puppeteer 等第三方开源组件仍受其各自许可证约束，本声明不覆盖。
> 商业授权请通过仓库主页联系作者。

---

## 一、整体使用流程

```
录口播 → 出字幕(SRT) → AI 编排(出 JSON) → 工作台预览/微调 → 导出视频 → 剪映合成
        └──────────────┘  这几步可交给 AI 技能自动完成
```

| 步骤 | 谁来做 | 说明 |
|---|---|---|
| 1. 录口播 | 你 | 正常录制口播视频 |
| 2. 出字幕 | 你 / AI | 用任意字幕工具导出 SRT，或让 AI 整理稿 |
| 3. AI 编排 | **AI 技能** | 把 SRT 交给 `overlay-generator` 技能，AI 决定每张卡的进出点与参数，产出 overlay JSON |
| 4. 预览微调 | 你 + 工作台 | 启动工作台载入 JSON，三栏拖滑杆调参，所见即所得 |
| 5. 导出视频 | 工作台 | 逐帧渲染成透明 MOV（带 alpha，叠进剪映） |
| 6. 剪映合成 | 你 | 把 MOV 拖进剪辑软件盖在原片上方 |

> 只有第 3 步「AI 编排」花 token；预览与导出都是本机计算，**零 token、可复现**。

---

## 二、启动工作台

你拿到的包，根目录里就有 **`MotionDeck/`**、**`skills/`** 和本说明。真正能跑的是 **`MotionDeck/`** 子目录（自带 node 服务，开箱即用）。

**推荐：双击启动**
- Windows：进 `MotionDeck` 子目录，双击 `start.bat`
- macOS：进 `MotionDeck` 子目录，双击 `start.command`

> **macOS 首次使用需先加可执行权限**：从仓库克隆或解压得到的 `start.command` 默认没有可执行权限（常见于 `-rw-r--r--`），直接双击会报「无法执行」。请先在终端执行：
> ```bash
> chmod +x start.command
> ```
> 之后双击即可。若仍提示「已损坏/无法打开」，再执行 `xattr -dr com.apple.quarantine start.command` 解除隔离。Windows 的 `start.bat` 无需此步。

启动会自动装依赖并打开浏览器，默认地址 `http://localhost/`（端口 80）。

**或命令行：**
```bash
cd MotionDeck
npm install      # 首次需要，装 puppeteer 等导出依赖（国内用户建议加 --registry=https://registry.npmmirror.com 走淘宝镜像）
npm start
```

> 环境要求（简述）：本机需有 Node.js ≥ 22.12 与 ffmpeg（仅导出视频需要，纯预览编辑不依赖）。具体安装按你本机环境来即可；服务器无界面环境用 `NO_OPEN=1 npm start` 关掉自动开浏览器；端口被占用时设 `PORT=8080` 换端口。
>
> **依赖默认走国内镜像**：双击 `start.bat` / `start.command` 时，puppeteer、Chromium、ffmpeg 等可下载依赖默认全部从 npmmirror（淘宝镜像）拉取——Chromium 原走 Google CDN、ffmpeg 二进制原走 GitHub，二者在国内的网络都不稳定，已改为镜像源，无需你手动配置。手动在命令行跑 `npm install` 想走国内源时，加 `--registry=https://registry.npmmirror.com` 即可。

---

## 三、编辑、保存与导出

- **载入工程**：把 AI 编排产出的 overlay JSON（或别人传来的 JSON）用页面导入按钮载入。
- **预览微调**：三栏预览台直接拖滑杆调动画进出点、参数，页面所见即导出所见。
- **保存工程**：导出 JSON 文件，方便来回传、做版本管理。
- **导出视频**：点「导出」选格式——只导透明 MOV（带 alpha，盖进剪映）。工具用本机浏览器逐帧渲染 + ffmpeg 合成，进度实时可见。

---

## 四、卡片系统

工作台启动时会加载三类卡片，互不阻断、失败都忽略：

- **内置卡**：打包进程序，开箱即用（核心 22 张恒可见，其余随云端授权解锁）。
- **外置卡**：往 `MotionDeck/data/cards/` 丢一个 `<id>.json`（命令式动画再附 `<id>.hook.mjs`），刷新即生效，**免改代码、免构建**。
- **云端动态卡**：由云端授权服务分发，授权后自动加载（spec 公开可直链）。

**加一张新卡**：把需求描述给 AI，装载 `card-spec-generator` 技能，它会按契约产出卡片 JSON 丢进 `data/cards/`；你也可以手动按下面的规范写。

### 外置卡片详解（`data/cards/`）

本目录存放**你自己维护的动效卡片**。把卡片 JSON 丢进这里（可选再配一个 `.hook.mjs`），刷新页面即可在效果库的「本地卡片」分组里看到，无需重新构建主程序。

> 权威 spec 定义在 `skills/card-spec-generator/SKILL.md`，下面给可直接拷贝的样例。运镜·相机卡（`cam-*` 8 张）与网页截图卡（`webspot-*` 5 张）**当前不支持自建**，不能放这里（见下方「护栏」）。

**工作机制（读一次就够）**
- 应用启动时，`useCatalogLoader()` 调 `GET /api/cards`，聚合本目录下所有 `*.json`，逐张合成 `EffectDef` 追加进 `EFFECTS`。编辑器 / 参数面板 / 画布 / 导出**全部零改动**即可识别。
- 生产态由 `MotionDeck/server.mjs` 的 `/api/cards`（读本目录）+ `/api/cards/:id/code.js`（读 `<id>.hook.mjs`）提供同名接口。
- 生效方式：丢文件 → 刷新页面 → 出现在「本地卡片」分组 → 可预览 / 编排 / 导出。

**一张卡的完整结构（`EffectSpec`）**
```jsonc
{
  "id": "my-fade-text",          // 唯一;不能撞 cam-* 等内置相机 id(见护栏)
  "name": "淡入文字",
  "group": "本地卡片",            // 可选;当前按来源归到「本地卡片」
  "description": "用户自定义：文字淡入上浮",
  "tags": ["文字", "入场"],
  "vTier": "half",               // 可选:"still" | "half" | "full"
  "selfPosition": false,         // 可选:true 表示该卡自己决定位置
  "form": "hud",                 // 可选:不写默认 "hud";cam / webspot 会被护栏拒绝
  "defaults": { "text": "你好，MotionDeck", "color": "#ffffff" },
  "controls": [ /* 见下方 controls 形状 */ ],
  "render": { /* 见下方 declarative 或 hook */ }
}
```
> 注意：`varMap` 字段类型里存在但渲染器当前**不消费**——模板里直接用 `{{参数key}}` 即可，不要依赖 `varMap`。

**两种渲染形式**

`declarative`（纯模板 + CSS，零编译，最轻）：
```jsonc
{
  "id": "my-fade-text", "name": "淡入文字", "form": "hud",
  "defaults": { "text": "你好，MotionDeck", "color": "#ffffff" },
  "controls": [
    { "key": "text", "label": "文案", "type": "text" },
    { "key": "color", "label": "颜色", "type": "color" }
  ],
  "render": {
    "type": "declarative",
    "trigger": "onPlay",
    "template": "<div class=\"my-fade\" style=\"color:{{color}};font-weight:800;font-size:48px\">{{text}}</div>",
    "style": ".card-my-fade-text .my-fade{opacity:0;transform:translateY(20px);} .card-my-fade-text.is-playing .my-fade{animation:myFade 1.2s ease forwards;} @keyframes myFade{to{opacity:1;transform:translateY(0);}}"
  }
}
```
- 模板引擎支持 `{{var}}`、`{{#each key}}…{{/each}}`、`{{#if key}}…{{/else}}…{{/if}}`、循环内 `{{@index}}` / `{{@value}}`。`var` 会被 HTML 转义后替换。
- `style` 是静态注入（每张卡 id 只注入一次），**不会**对 `{{参数}}` 做替换。动态值写进 `template` 的内联 `style`（如上 `color:{{color}}`）。
- 动画靠根节点拿到 `.is-playing` 类 + CSS 变量 `--t`（自播放起点起的毫秒，逐帧更新）驱动。

`hook`（命令式原生 DOM，有真实 JS 逻辑时用）——需要 `<id>.hook.mjs`（与 JSON 同目录），导出 `render(node, ctx)`：
```js
// my-pulse-dot.hook.mjs
export function render(node, ctx) {
  node.innerHTML = '<div class="pulse"></div>';
  const dot = node.firstChild;
  let raf = 0;
  const tick = () => {
    const t = ctx.time();                       // 自播放起点的 ms,与导出同钟源
    const s = 1 + 0.3 * Math.sin(t / 300);
    dot.style.transform = `scale(${s})`;
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(raf);       // 卸载/改参时清理
}
```
```jsonc
{
  "id": "my-pulse-dot", "name": "脉冲圆点", "form": "hud", "selfPosition": true,
  "defaults": {}, "controls": [],
  "render": { "type": "hook", "entry": "/api/cards/my-pulse-dot/code.js" }
}
```
- `entry` 默认就是 `/api/cards/<id>/code.js`，可省略；内联 `"render": { "type": "hook", "code": "<JS 字符串>" }` 也能用（经 Blob 动态 import，原型用）。
- `ctx = { params, time, playToken, vars }`。**必须用 `ctx.time()`**，不可用 `Date.now()` / `Math.random()`，否则导出帧对不上。
- 模块是**浏览器原生 ESM**：**不能写 JSX/TS**（语法错误 → 捕获后显示「钩子加载失败」），**不能 `import "react"` 等裸模块名**（运行时 `import()` 不过 Vite 转译，生产环境解析不了）。用原生 DOM 操作 `node`。
- `render` 返回的清理函数会在卡片卸载 / 参数变动时被调用。

**`controls` 字段形状（与编辑器一致）**

| type | 字段 |
|---|---|
| `range` | `key,label,type:"range",min,max,step,unit?` |
| `text` | `key,label,type:"text"` |
| `textarea` | `key,label,type:"textarea",rows?,help?` |
| `select` | `key,label,type:"select",options:[{label,value}]` |
| `toggle` | `key,label,type:"toggle"` |
| `color` | `key,label,type:"color"` |
| `media` | `key,label,type:"media",accept?,noun?,capture?,advanced?` |

示例：
```jsonc
"controls": [
  { "key": "size", "label": "字号", "type": "range", "min": 12, "max": 96, "step": 1, "unit": "px" },
  { "key": "align", "label": "对齐", "type": "select", "options": [
    { "label": "左", "value": "left" }, { "label": "中", "value": "center" }
  ] },
  { "key": "bold", "label": "加粗", "type": "toggle" }
]
```
`defaults` 里的 key 必须与 `controls[].key` 对应。

**护栏：哪些卡不能放这里**（被 `rejectReason` 拦截，效果库顶部红字列出原因，不会静默变成不动的卡）
1. `form` 写成 `"cam"` 或 `"webspot"` → 拒绝（相机卡依赖 `Canvas + camMoves.ts`、截图卡依赖 `WebSpotBase.tsx`，在线卡引用不到）。
2. `id` 撞上内置相机卡（`cam-push-in` / `cam-pull-reveal` / `cam-cursor-zoom` / `cam-pip-zoom` / `cam-orbit` / `cam-tour` / `cam-sway` / `cam-tilt`）→ 即使没写 `form` 也会被当成想改相机卡而拒。
3. 网页截图类（`webspot-*`）同理被 `form:"webspot"` 拦下。
→ 这些卡当前不支持自建。

**静默失败排查（先看这里）**
- JSON 解析失败 → `server.mjs` 静默跳过该文件，不加载也不提示。请用 json 校验工具确认格式。
- 钩子模块没 `export function render` → `mod.render?.()` 是 no-op，节点空白、不报错。
- 钩子写了 JSX/TS 或裸 `import "react"` → 动态 import 抛错，节点显示「钩子加载失败」。
- 被护栏拒绝 → 不是静默失败：效果库顶部红字会列出 `id + 原因`，同时控制台有 `[在线卡] <id> 未加载:…` 警告。
- 任何「没出现在库里」的卡，先开浏览器控制台看 `[在线卡]` 警告，再核对上面几条。

**安全提示**
内联 `code` 经 `Blob` + `import()` 在每个**观看者浏览器**里执行任意 JS。若本目录可由**不可信 / 多租户**用户写入，需要额外沙箱（iframe sandbox / CSP / Web Worker 隔离）。单运营者自维护本机目录则无此问题。

**最小可运行样例（直接拷走）**
- 声明式：把上面的 declarative JSON 存为 `my-fade-text.json` 丢进 `data/cards/` 即可。
- 钩子式：把上面的 JSON 存为 `my-pulse-dot.json`、JS 存为 `my-pulse-dot.hook.mjs`，两个都丢进 `data/cards/`。
刷新页面 → 「本地卡片」分组里出现这两张 → 拖到画布预览 → 导出成片。

---

## 五、自定义字体与音效

工作台运行时支持两类素材外部注入，**无需重新构建**：

- **字体**：把 `.ttf` / `.otf` / `.woff` / `.woff2` 丢进 `MotionDeck/html/fonts/`（与 `html/sfx` 并列，启动服务时自动建好），刷新页面，「全局字体」下拉和字幕卡的「字幕字体」框即可选用。字体名 = 文件名（去扩展名）；同一家族多字重写成「家族名-字重数字」（如 `思源黑体-400.otf` / `思源黑体-700.otf`），会合并成一个下拉项、各字重按真字形渲染（不是伪粗）。
- **音效**：把 `.mp3` 丢进 `MotionDeck/html/sfx/`，卡片参数面板的「音效」即可引用同名文件（`/sfx/<文件名>.mp3`）。

> 为什么是这里：编译产物 `html/` 是静态构建输出，服务直接托管它，这两个目录由 server 在运行时读取，所以放进去即时生效——和「外置卡」一样免构建。换字体直接覆盖 `html/fonts/` 下文件、刷新即可；若 `html/` 被重新生成（如更新发布包），需把字体重新放入新生成的 `html/fonts/`（音效同理）。字体去哪下、命名规则、授权注意见 `MotionDeck/html/fonts/README.md`（随包发布，与上面丢文件同一目录）；很多「免费商用」字体不允许随软件再分发，引入前请确认授权。

---

## 六、AI 技能（让 Agent 帮你干活）

`skills/` 目录随包分发，内含两个技能，**每个技能是一个独立文件夹，入口是文件夹里的 `SKILL.md`**：

- **`overlay-generator`**：口播稿 / SRT → 动效编排 JSON。决定哪句话配哪张卡、几点 in/out、填什么参数。这是唯一花 token 的一步。
- **`card-spec-generator`**：脚本 / 需求描述 → 卡片清单（外置卡 JSON）。帮你快速扩充卡片库。

### 安装到你的 Agent 框架

把这两个技能**整文件夹**拷进 Agent 框架的 skills 目录（只拷 `SKILL.md` 会丢掉 `agents/`、`STATUS.template.md` 等配套文件，导致技能残缺）。

**识别机制（跨框架通用）**：框架靠扫描 skills 目录下每个子文件夹里的 `SKILL.md`（含 `name` / `description` 字段）来认技能。本包两个技能的**文件夹名已与 `SKILL.md` 里的 `name` 一致**（`overlay-generator` / `card-spec-generator`），整目录拷过去即可被准确识别，无需改名。

**不同框架的 skills 目录**（把 `overlay-generator` 和 `card-spec-generator` 两个文件夹整目录拷进去）：

| 框架 | skills 目录（用户级） | 项目级 |
|---|---|---|
| WorkBuddy | `~/.workbuddy/skills/` | `<项目>/.workbuddy/skills/` |
| Claude Code | `~/.claude/skills/` | `<项目>/.claude/skills/` |
| 其它框架 | 查阅该框架文档里「skills / 插件 / 命令」目录约定 | — |

示例（macOS / Linux，装到 WorkBuddy 用户级）：
```bash
cp -R skills/overlay-generator ~/.workbuddy/skills/
cp -R skills/card-spec-generator ~/.workbuddy/skills/
```
Windows（PowerShell）：
```powershell
Copy-Item -Recurse skills\overlay-generator $env:USERPROFILE\.workbuddy\skills\
Copy-Item -Recurse skills\card-spec-generator $env:USERPROFILE\.workbuddy\skills\
```

> 装完**重启 / 刷新 Agent 会话**，框架即扫描到这两个技能；之后用自然语言下达任务即可，例如：「读这段口播稿，给我出一份动效编排」或「按这个脚本加一张金句卡」。若某框架要求 skills 目录另有索引文件（少数框架），按该框架文档补一条指向这两个文件夹的条目即可。

---

## 七、常见问题

- **导出提示「渲染器没装好」** → 跑 `npm run setup` 重新准备浏览器渲染组件。
- **导出提示找不到 ffmpeg** → 确认本机已装 ffmpeg 且命令行能跑 `ffmpeg -version`。
- **只想预览编辑、暂不导出** → 完全没问题，编辑与 JSON 收发不依赖视频导出。
