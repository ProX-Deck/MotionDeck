#!/usr/bin/env node
/**
 * MotionDeck 独立交付服务（替代 v1.0.1 的 vite dev 中间件）
 * ---------------------------------------------------------------
 * 这个文件让 MotionDeck 可以作为一个独立交付目录、单独启动一个 node 服务，
 * 完整复刻 v1.0.1「系统原有功能」：
 *   - 托管静态 web（根目录指向 html/，页面用绝对路径 /assets、/api、/demo、/sfx、/_media）
 *   - 运行期资源回喂：output/src/video（/_media、/demo）、output/cache（/_fxframes），demo 同时兜底 html/demo 种子
 *   - 后端 API：/api/media、/api/upload-demo、/api/review-log、/api/export、/api/export-status、/api/overlay(只读拉取权威卡片)、/api/cards(在线卡片目录)、/api/presets(参数预设落盘)、/api/cards/:id/code.js(命令式卡钩子模块)
 *   - /api/export 起无头 Chrome 逐帧渲染 + ffmpeg 合成（见 scripts/export-frames.mjs）
 *
 * 默认端口 80（本地 web 服务，浏览器直接 http://localhost/ 访问，无需输端口）。
 * PORT 环境变量可覆盖（如 8080），用于 80 被占或无管理员权限时。
 * 端口绑定失败（被占用 / 权限不足）→ 自动顺延到下一个可用端口，
 * 并在日志打印真实访问地址、自动用对应端口打开浏览器（见底部 listen 逻辑）。
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = __dirname; // MotionDeck 根（本交付目录）
const HTML = path.join(DIST, "html"); // 静态 web
const FONT_DIR = path.join(HTML, "fonts"); // 运行期外置字体(与 html/sfx 并列)
const DATA = path.join(DIST, "data"); // 运行态目录(授权清单/外置卡等,整目录 gitignore)
const CARDS_DIR = path.join(DATA, "cards"); // 外置卡片(丢 <id>.json 即生效)
const PRESETS_FILE = path.join(DATA, "presets.json"); // 参数预设落盘(只套样式,跨会话长期有效)
const OUT = path.join(DIST, "output"); // 运行导出物
// ── output 内部子目录（按"素材 / 产物"分离重排，见《本地优先架构方案.md》§3） ──
// 当前不移到桌面：output 仍留在 MotionDeck/output，但内部结构对齐未来桌面方案
// （桌面化时只需把整个 output/ 搬到 桌面/MotionDeck/<项目名>/）。
const SRC = path.join(OUT, "src");
const SRC_VIDEO = path.join(SRC, "video");   // 导入视频(_media) + 录屏(demo)
const SRC_IMAGE = path.join(SRC, "image");   // 图片素材（技能/工作台，未来）
const SRC_AUDIO = path.join(SRC, "audio");   // 音频素材（未来）
const CACHE = path.join(OUT, "cache");        // 抽帧缓存 _fxframes
const LOGS = path.join(OUT, "logs");          // 学习日志 review-logs
const TMP = path.join(OUT, "tmp");            // 临时混音 _tmp
// 启动时确保各子目录存在（空目录 git 不跟踪，这里提前建好便于查看与排查）
for (const d of [SRC_VIDEO, SRC_IMAGE, SRC_AUDIO, CACHE, LOGS, TMP, path.join(OUT, "frames")]) {
  fs.mkdirSync(d, { recursive: true });
}
// 运行期外置字体目录:编译产物里也能像音效一样丢字体即用,无需重新构建
fs.mkdirSync(FONT_DIR, { recursive: true });
// 外置卡片目录:整目录 data/ 被 gitignore,交付包里没有 data/,这里启动兜底建好,
// 用户直接往 data/cards/ 丢 <id>.json 即可被 /api/cards 加载(否则需手动 mkdir)
fs.mkdirSync(CARDS_DIR, { recursive: true });
// 默认 80 端口（本地服务，浏览器直接 http://localhost/ 访问）。
// 允许 PORT 环境变量覆盖（如 8080），用于受限环境或 80 被占 / 无管理员权限时。
// 绑定失败会自动顺延到候选列表里的下一个端口（见底部 listen 逻辑）。
let PORT = Number(process.env.PORT) || 80;

// ───────────────────────── 通用：上传落盘（草稿→誊正） ─────────────────────────
// 移植自 v1.0.1 的保存/重命名逻辑（saveUpload / renameWithRetry）。
// 守住两条：① 草稿名唯一（同素材并发传不互相覆盖）；② 誊正失败不许把服务带走。
let uploadSeq = 0;
function saveUpload(req, res, dest, urlPath) {
  const tmp = `${dest}.${process.pid}-${Date.now()}-${++uploadSeq}.part`;
  const ws = fs.createWriteStream(tmp);
  let settled = false;
  const reply = (code, body) => {
    if (settled) return;
    settled = true;
    try {
      if (code !== 200) fs.rmSync(tmp, { force: true });
    } catch (e) {
      console.error(`[upload] 草稿删不掉(留着,下次启动再清):${tmp}`, e);
    }
    try {
      res.statusCode = code;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    } catch (e) {
      console.error("[upload] 回应失败(多半是客户端已断开):", e);
    }
  };
  const fail = (why) => {
    const done = () => reply(500, { ok: false, error: why });
    if (ws.closed) done();
    else {
      ws.once("close", done);
      ws.destroy();
    }
  };
  req.on("close", () => {
    if (!req.complete) fail("上传中断");
  });
  req.on("error", (e) => fail(String(e)));
  ws.on("error", (e) => fail(String(e)));
  ws.on("finish", () => {
    void (async () => {
      try {
        await renameWithRetry(tmp, dest);
        const v = Math.floor(fs.statSync(dest).mtimeMs);
        reply(200, { ok: true, url: `${urlPath}?v=${v}`, src: `${urlPath}?v=${v}` });
      } catch (e) {
        fail(`写入失败:${e}`);
      }
    })();
  });
  req.pipe(ws);
}

async function renameWithRetry(tmp, dest) {
  const waits = [0, 200, 500, 1000];
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await new Promise((r) => setTimeout(r, waits[i]));
    try {
      fs.renameSync(tmp, dest);
      return;
    } catch (e) {
      if (i === waits.length - 1) throw e;
    }
  }
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  const MAP = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
    ".m4v": "video/x-m4v", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
    ".json": "application/json", ".txt": "text/plain; charset=utf-8",
    ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
  };
  return MAP[ext] || "application/octet-stream";
}

// 安全地把请求路径解析到 base 目录内（防 ../ 穿越）
function safeJoin(base, urlPath) {
  const rel = decodeURIComponent((urlPath || "").split("?")[0]).replace(/^\/+/, "");
  const full = path.join(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) return null; // 越界
  return full;
}

// ───────────────────────── 导出进度（/api/export-status 轮询） ─────────────────────────
let busy = false;
let prog = {
  running: false, stage: "done", frame: 0, total: 0,
  startedAt: 0, framesAt: 0, ok: undefined,
};

// ───────────────────────── 静态 / 运行期资源服务 ─────────────────────────
// ⚠️ 必须支持 HTTP Range(206 Partial Content),别改回裸 pipe。
//
// 没有它,响应既没 Content-Length 也没 Accept-Ranges(只剩 chunked),浏览器会把
// 这段媒体当成**不可 seek 的流**:v.currentTime = t 落不了位、静默跳回 0,
// 于是「点选某处再按播放 → 却从头播放」。这与编码**无关**——H.264 的小文件照样
// 复现;而用 blob 临时链接播放时一切正常(那时浏览器持有完整文件、可随意 seek),
// 差别只在于服务端有没有给 Range。
function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const size = st.size;
    res.setHeader("Content-Type", contentType(file));
    res.setHeader("Accept-Ranges", "bytes");

    // 单段 Range:bytes=start-end / bytes=start- / bytes=-suffix
    // 多段(bytes=0-99,200-299)不解析:下面的正则匹配不上,整体按 200 全量返回。
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || "").trim());
    if (m) {
      let start = m[1] === "" ? null : Number(m[1]);
      let end = m[2] === "" ? null : Number(m[2]);
      if (start === null && end !== null) {
        start = Math.max(0, size - end);
        end = size - 1;
      }
      if (start === null) start = 0;
      if (end === null || end >= size) end = size - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${size}`);
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", String(end - start + 1));
      fs.createReadStream(file, { start, end })
        .on("error", () => {
          res.statusCode = 500;
          res.end("Read error");
        })
        .pipe(res);
      return;
    }

    // 普通请求:补上 Content-Length(浏览器据此判断资源长度、决定能否 seek)
    res.setHeader("Content-Length", String(size));
    fs.createReadStream(file)
      .on("error", () => {
        res.statusCode = 500;
        res.end("Read error");
      })
      .pipe(res);
  });
}

// 运行期前缀 → output/ 下目录（页面 URL 不变，仅服务端磁盘映射改到新子目录）；
// demo 额外兜底 html/demo 种子
const RUNTIME_MAP = [
  ["/_media", SRC_VIDEO],
  ["/_fxframes", CACHE],
];
function tryRuntime(req, res, urlPath) {
  for (const [prefix, dir] of RUNTIME_MAP) {
    if (urlPath === prefix || urlPath.startsWith(prefix + "/")) {
      const file = safeJoin(dir, urlPath.slice(prefix.length));
      if (!file) {
        res.statusCode = 400;
        res.end("Bad path");
        return true;
      }
      serveFile(req, res, file);
      return true;
    }
  }
  // /demo：先 runtime(output/src/video)，再种子(html/demo)
  if (urlPath === "/demo" || urlPath.startsWith("/demo/")) {
    const rel = urlPath.slice("/demo".length) || "/";
    const rt = safeJoin(SRC_VIDEO, rel);
    const seed = safeJoin(path.join(HTML, "demo"), rel);
    if (rt && fs.existsSync(rt) && fs.statSync(rt).isFile()) serveFile(req, res, rt);
    else if (seed) serveFile(req, res, seed);
    else {
      res.statusCode = 404;
      res.end("Not found");
    }
    return true;
  }
  return false;
}

function serveStatic(req, res, urlPath) {
  if (urlPath === "/" || urlPath === "") {
    serveFile(req, res, path.join(HTML, "index.html"));
    return;
  }
  const file = safeJoin(HTML, urlPath);
  if (!file) {
    res.statusCode = 400;
    res.end("Bad path");
    return;
  }
  serveFile(req, res, file);
}

// ───────────────────────── API 处理 ─────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleApi(req, res, urlPath) {
  // ---- /api/media：导入视频落盘到 output/src/video，返回可用路径 ----
  if (urlPath === "/api/media") {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end('{"ok":false}');
      return;
    }
    const raw = String(req.headers["x-filename"] ?? "video");
    const safe = decodeURIComponent(raw).replace(/[^\w.\-\u4e00-\u9fff]/g, "_").slice(-80);
    const dir = SRC_VIDEO;
    fs.mkdirSync(dir, { recursive: true });
    saveUpload(req, res, path.join(dir, safe), `/_media/${encodeURIComponent(safe)}`);
    return;
  }

  // ---- /api/upload-demo：录屏上传到 output/src/video ----
  if (urlPath === "/api/upload-demo") {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("POST only");
      return;
    }
    const q = new URL(req.url ?? "", "http://x").searchParams;
    const raw = decodeURIComponent(q.get("name") || "demo.mp4");
    const name = path.basename(raw).replace(/[^\w.一-龥()-]/g, "_");
    const dir = SRC_VIDEO;
    fs.mkdirSync(dir, { recursive: true });
    saveUpload(req, res, path.join(dir, name), `/demo/${name}`);
    return;
  }

  // ---- /api/review-log：学习闭环，原样落盘 ----
  if (urlPath === "/api/review-log") {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("POST only");
      return;
    }
    const body = await readBody(req);
    try {
      JSON.parse(body);
      const dir = LOGS;
      fs.mkdirSync(dir, { recursive: true });
      // 本地时区时间戳(本机 Asia/Shanghai/GMT+8), 不再用 toISOString 的 UTC
      const p2 = (n) => String(n).padStart(2, "0");
      const stamp = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}`;
      })();
      const dest = path.join(dir, `${stamp}-review-log.json`);
      fs.writeFileSync(dest, body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, file: dest }));
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // ---- /api/export-status：轮询进度 ----
  if (urlPath === "/api/export-status") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(prog));
    return;
  }

  // ---- /api/export：起无头 Chrome 逐帧渲染 + ffmpeg 合成 ----
  if (urlPath === "/api/export") {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("POST only");
      return;
    }
    if (busy) {
      res.statusCode = 429;
      res.end(JSON.stringify({ ok: false, error: "已有导出任务在进行中" }));
      return;
    }
    const body = await readBody(req);
    busy = true;
    try {
      const job = JSON.parse(body || "{}");
      job.base = `http://localhost:${PORT}`;
      const jobFile = path.join(os.tmpdir(), `overlay-export-${Date.now()}.json`);
      fs.writeFileSync(jobFile, JSON.stringify(job));

      const child = spawn(
        "node",
        [path.join(DIST, "scripts", "export-frames.mjs"), jobFile],
        { cwd: DIST, stdio: ["ignore", "pipe", "pipe"] },
      );
      prog = {
        running: true, stage: "prep", frame: 0, total: 0,
        startedAt: Date.now(), framesAt: 0, ok: undefined, phasePct: undefined,
      };
      let out = "";
      let err = "";
      const IDLE_MS = 15 * 60_000;
      const giveUp = () => {
        err +=
          "\n【导出失败原因】导出 15 分钟没有任何进展,已强制停止。多半是渲染器假死了:" +
          "重新导出一次;还不行就重启服务。";
        child.kill("SIGKILL");
      };
      let idle = setTimeout(giveUp, IDLE_MS);
      const kick = () => {
        clearTimeout(idle);
        idle = setTimeout(giveUp, IDLE_MS);
      };
      child.stdout.on("data", (d) => {
        kick();
        out += d;
        process.stdout.write(`[export] ${d}`);
        const m = [...out.matchAll(/progress (\d+)\/(\d+)/g)].pop();
        if (m) {
          prog.frame = Number(m[1]);
          prog.total = Number(m[2]);
          prog.stage = "frames";
        }
        const mp = [...out.matchAll(/mprogress (\d+)/g)].pop();
        if (mp) prog.phasePct = Number(mp[1]);
        if (prog.stage === "prep" && out.includes("extracting video frames")) prog.stage = "extract";
        if (!prog.framesAt && out.includes("rendering frames:")) {
          prog.framesAt = Date.now();
          prog.stage = "frames";
        }
        if (out.includes("composing")) prog.stage = "mov";
        if (out.includes("baking")) prog.stage = "sfx";
      });
      child.stderr.on("data", (d) => {
        kick();
        err += d;
        process.stderr.write(`[export] ${d}`);
      });
      child.on("close", (code) => {
        clearTimeout(idle);
        busy = false;
        prog = { ...prog, running: false, stage: "done", ok: code === 0 };
        fs.rmSync(jobFile, { force: true });
        res.setHeader("Content-Type", "application/json");
        if (code === 0) {
          const lines = out.trim().split("\n");
          res.end(lines[lines.length - 1]);
        } else {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: err.slice(-800) }));
        }
      });
    } catch (e) {
      busy = false;
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // /config.json 已废弃:域名硬编码进前端、由云端授权解锁卡片,不再依赖此配置。

  // ---- /api/config：读取本机 data/config.json(用户手动编辑的访问凭据等)----
  // 工作台启动时拉取 accessKey 用于云端授权;文件不存在 / 缺字段 → 回退未授权。
  if (urlPath === "/api/config") {
    try {
      const file = path.join(DIST, "data", "config.json");
      if (!fs.existsSync(file)) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ accessKey: "" }));
        return;
      }
      const raw = fs.readFileSync(file, "utf8");
      let cfg = {};
      try {
        cfg = JSON.parse(raw);
      } catch {
        cfg = {};
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ accessKey: typeof cfg.accessKey === "string" ? cfg.accessKey : "" }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // ---- /api/cards：聚合卡片目录（在线可加的动效卡片类型，见 docs/card-spec-design.md）----
  if (urlPath === "/api/cards") {
    try {
      const dir = path.join(DIST, "data", "cards");
      fs.mkdirSync(dir, { recursive: true }); // 兜底建目录,用户无需手动 mkdir
      const list = [];
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith(".json")) continue;
          try {
            const spec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
            if (spec && spec.id) list.push(spec);
          } catch {
            /* 坏文件跳过,不阻断其他卡 */
          }
        }
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(list));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // ---- /api/cards/:id/code.js：命令式卡的渲染钩子模块 ----
  const codeMatch = /^\/api\/cards\/([^/]+)\/code\.js$/.exec(urlPath);
  if (codeMatch) {
    const id = decodeURIComponent(codeMatch[1]);
    const file = safeJoin(path.join(DIST, "data", "cards"), `${id}.hook.mjs`);
    if (!file) {
      res.statusCode = 400;
      res.end("Bad path");
      return;
    }
    if (!fs.existsSync(file)) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    res.setHeader("Content-Type", "text/javascript");
    fs.createReadStream(file).pipe(res);
    return;
  }

  // ---- /api/local-manifest：工作台启动后回写本机可用卡清单(供技能读取,不含域名)----
  if (urlPath === "/api/local-manifest") {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("POST only");
      return;
    }
    try {
      const body = await readBody(req);
      const dir = path.join(DIST, "data");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "available-cards.json"), body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // ---- /api/presets：参数预设落盘(只套样式,见 ParamsPanel.tsx;data/ 整目录 gitignore)----
  if (urlPath === "/api/presets") {
    try {
      if (req.method === "GET") {
        fs.mkdirSync(DATA, { recursive: true }); // 兜底建目录
        const store = fs.existsSync(PRESETS_FILE)
          ? JSON.parse(fs.readFileSync(PRESETS_FILE, "utf8"))
          : {};
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(store));
      } else if (req.method === "POST") {
        const body = await readBody(req);
        const incoming = JSON.parse(body);
        fs.mkdirSync(DATA, { recursive: true });
        const existing = fs.existsSync(PRESETS_FILE)
          ? JSON.parse(fs.readFileSync(PRESETS_FILE, "utf8"))
          : {};
        // 按 effectId 合并:传入的卡类型覆盖,未传的卡类型保留
        const merged = { ...existing };
        for (const [k, v] of Object.entries(incoming)) merged[k] = v;
        fs.writeFileSync(PRESETS_FILE, JSON.stringify(merged, null, 2));
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.statusCode = 405;
        res.end(JSON.stringify({ ok: false }));
      }
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // ---- /api/fonts：运行期外置字体清单(html/fonts/ 下所有字体文件)----
  // 字体名 = 文件名(去扩展名);同家族多字重「家族名-字重数字」合并。前端据此动态注册 @font-face。
  if (urlPath === "/api/fonts") {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    try {
      fs.mkdirSync(FONT_DIR, { recursive: true });
      const names = fs.existsSync(FONT_DIR) ? fs.readdirSync(FONT_DIR) : [];
      const re = /\.(ttf|otf|woff2?)$/i;
      const list = names
        .filter((n) => re.test(n))
        .map((n) => {
          const base = n.replace(re, "");
          const m = base.match(/^(.+)-(\d{3})$/);
          return { family: m ? m[1] : base, weight: m ? m[2] : "400", file: n };
        });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(list));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  res.statusCode = 404;
  res.end("Unknown API");
}

// ───────────────────────── 请求入口 ─────────────────────────
const server = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  if (urlPath.startsWith("/api/")) {
    handleApi(req, res, urlPath).catch((e) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }
  if (tryRuntime(req, res, urlPath)) return;
  serveStatic(req, res, urlPath);
});

// 前置检查:静态 web 是否已构建。
// html/ 是随发布包提供的静态页面;若缺失,说明拿到的不是完整发布包。
// 不拦的话服务照常起来、每个请求都是 404,用户只看到白屏,查不出原因。
// 这里直接说清楚缺什么、怎么补。
if (!fs.existsSync(path.join(HTML, "index.html"))) {
  console.error(`\n❌ 没找到静态 web:${path.join(HTML, "index.html")}`);
  console.error(`   html/ 是运行所需的静态页面,应随发布包一并提供。`);
  console.error(`   请确认你拿到的是完整发布包(含 html/ 目录),或重新获取一次发布包,`);
  console.error(`   然后在本目录运行启动命令即可。\n`);
  process.exit(1);
}

// 自动打开浏览器（跨平台）。NO_OPEN=1 时关闭（服务器 / 无 GUI 场景）。
function openBrowser(url) {
  let cmd, args;
  if (process.platform === "darwin") { cmd = "open"; args = [url]; }
  else if (process.platform === "win32") { cmd = "cmd"; args = ["/c", "start", "", url]; }
  else { cmd = "xdg-open"; args = [url]; }
  try {
    const p = spawn(cmd, args, { detached: true, stdio: "ignore" });
    p.on("error", () => {}); // 命令缺失 / 无 GUI 时不阻塞
    p.unref();
  } catch (e) {
    /* ignore */
  }
}

// ───────────────────────── 端口协商:绑定失败自动顺延 ─────────────────────────
// 默认走 80(浏览器免输端口);80 被占 / 无管理员权限(EADDRINUSE / EACCES)就顺延到下一个
// 可用端口,绝不静默失败。成功后在日志打印真实地址,并按真实端口自动打开浏览器。
const PORT_CANDIDATES = process.env.PORT
  ? [Number(process.env.PORT)]
  : [80, 8080, 3000, 5173, 9000];

function tryListen(i) {
  if (i >= PORT_CANDIDATES.length) {
    console.error("\n❌ 所有候选端口都不可用,MotionDeck 启动失败。请检查端口占用,或手动指定 PORT 再试。");
    process.exit(1);
  }
  const candidate = PORT_CANDIDATES[i];
  const onErr = (e) => {
    if (e.code === "EADDRINUSE" || e.code === "EACCES") {
      console.warn(`[端口] ${candidate} 不可用(${e.code}),自动尝试下一个…`);
      tryListen(i + 1);
    } else {
      throw e;
    }
  };
  server.once("error", onErr);
  server.listen(candidate, () => {
    server.off("error", onErr); // 成功绑定后撤掉本次的错误监听,避免后续运行期错误被误递归
    PORT = candidate; // 让 /api/export 的 job.base 用真实端口
    console.log(`\n🎬 MotionDeck 已启动: http://localhost:${candidate}/`);
    if (candidate !== 80) {
      console.log(`   (默认 80 端口不可用,已自动改用 ${candidate};如需固定可设 PORT 环境变量)`);
    }
    console.log(`   静态 web : ${HTML}`);
    console.log(`   运行导出物: ${OUT}`);
    console.log(`   关闭方法:  Ctrl+C\n`);
    if (process.env.NO_OPEN !== "1") openBrowser(`http://localhost:${candidate}/`);
  });
}
tryListen(0);
