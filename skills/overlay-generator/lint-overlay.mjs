#!/usr/bin/env node
/**
 * overlay-generator 交付前自检 —— 独立移植自工作台内置 overlay 体检(lint)规则
 * 目的:让技能阶段就能跑和工作台「体检」一致的检查,不依赖源码工程。
 *
 * 用法: node lint-overlay.mjs <overlay.json> [--duration 387.4] [--main-video]
 * 退出码: 有 error 级议题 => 1; 否则 0(仅 warn 也返回 0,因为 warn = 人判优先)。
 *
 * 移植说明:
 *  - 阈值(LINT_DEFAULTS)与 lint.ts 完全一致。
 *  - 不依赖 EFFECTS 注册表:placeholder-text 改为「启发式」(命中示例/占位等明显占位词即报 error);
 *    missing-cam 仅在 --main-video 未给且 JSON 无 cam 时对吃 camSrc 的卡型提示(本技能卡型均不吃,故基本不触发)。
 *  - 其余规则(quiet-gap/short-dwell/decimal-percent/caption-track/over-duration/相邻同kind/类型字符串)与工作台一致。
 */
import { readFileSync } from "node:fs";

const LINT_DEFAULTS = {
  minDwell: 2,
  dwellExemptKinds: new Set([
    "corner-bracket-frame", "chapter-bar", "caption-track",
    "soft-blur-in", "motion-blur-slam-in", "media-pop-in", "logo-enter",
    "highlighter-sweep", "ink-underline", "keyword-pop-highlight",
    "tracking-in", "converging-arrows",
    "impact-open-title", "chapter-title-card", "count-badge-title",
    "speed-slab-title", "slab-punch-title", "behind-text-title",
    "outline-box-title", "callout-line-label", "alt-block-lines",
    "line-by-line-slide", "type-contrast-emphasis", "ui-callout",
    "color-slam-beat-card",
  ]),
  maxQuietGap: 10,
  scaleTiers: [],
  warnCaptionTrack: true,
  warnDecimalPercent: true,
  warnBackdropStack: false,
  blockTitleMinOffsetY: 0,
};

// 吃人像源的卡型(本技能默认不产出,列出仅供 missing-cam 判定)
const CAM_KINDS = new Set([
  "talking-head", "face-reveal", "cam-spotlight", "person-insert",
  "split-screen-cam", "face-track",
]);

const SEQ_SPECS = {
  "terminal-3d": [{ step: "__span", list: "lines", sep: "|" }],
  "checklist": [{ step: "stepMs", list: "items", sep: "|" }],
  "entity-chips": [{ step: "stepMs", list: "chips" }],
  "focus-card": [{ step: "stepMs", list: "items", sep: "|" }],
  "blur-text": [{ step: "staggerMs", list: "text", sep: "|" }],
  "pin-board": [{ step: "stepMs", list: "items", sep: "|" }],
  "danmu-bubble-praise": [{ step: "staggerMs", list: "bubbles", sep: "|" }],
  "chapter-progress-list": [{ step: "staggerMs", list: "rows", sep: "|" }],
  "numbered-step-stack": [{ step: "staggerMs", list: "rows", sep: "|" }],
  "bar-chart-growth": [{ step: "staggerMs", list: "bars", sep: "|" }],
};

function isDemoCopy(s) {
  if (!s) return false;
  const cjk = (s.match(/[一-鿿]/g) ?? []).length;
  if (/示例|占位|可空|这一行|写在这|HERE/.test(s)) return true;
  return cjk >= 4;
}

function actionTimes(card) {
  const out = [];
  const p = card.params ?? {};
  const t = p.times;
  if (typeof t === "string") {
    out.push(...t.split(/[|,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0).map((n) => card.start + n));
  }
  if (card.kind === "strike-and-replace") {
    const lead = Number(p.leadMs) || 0, strike = Number(p.strikeMs) || 0, lag = Number(p.swapLagMs) || 0, swap = Number(p.swapMs) || 0;
    out.push(card.start + lead / 1000, card.start + (lead + strike + lag) / 1000, card.start + (lead + strike + lag + swap) / 1000);
  }
  if (card.kind === "type-shift") {
    const lines = String(p.lines ?? "").split("|").map((s) => s.trim()).filter(Boolean).length;
    const shiftAt = Number(p.shiftAtMs) || 0;
    for (let i = 0; i < lines; i++) out.push(card.start + 0.15 + i * 0.16);
    if (shiftAt > 0) out.push(card.start + shiftAt / 1000);
  }
  if (card.kind === "quote-lockup") {
    const lines = String(p.quote ?? "").split("|").map((s) => s.trim()).filter(Boolean).length;
    for (let i = 0; i < lines; i++) out.push(card.start + 0.14 + i * 0.15);
  }
  if (card.kind === "per-character-rise") {
    const lead = 300, stg = Number(p.staggerMs) || 0;
    const chars = Array.from(String(p.text ?? "")).length;
    for (let i = 0; i < chars; i++) out.push(card.start + (lead + i * stg) / 1000);
  }
  for (const spec of SEQ_SPECS[card.kind] ?? []) {
    const n = typeof p[spec.list] === "string" ? p[spec.list].split(spec.sep ?? "\n").map((x) => x.trim()).filter(Boolean).length : 0;
    if (n < 1) continue;
    const at = spec.at ? Number(p[spec.at]) || 0 : 0;
    const stepSec = spec.step === "__span" ? (card.end - card.start) / Math.max(n, 1) : (Number(p[spec.step]) || 0) / 1000;
    if (!Number.isFinite(stepSec) || stepSec <= 0) { out.push(card.start + at); continue; }
    for (let i = 0; i < n; i++) out.push(card.start + at + i * stepSec);
  }
  return out.filter((v) => v >= card.start - 0.01 && v <= card.end + 0.01);
}

function parseOverlay(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return { error: "JSON 解析失败: " + e.message }; }
  if (!raw || typeof raw !== "object") return { error: "顶层不是对象" };
  if (!Array.isArray(raw.cards)) return { error: "缺少 cards 数组" };
  const issues = [];
  for (const c of raw.cards) {
    if (typeof c.id !== "string") issues.push({ level: "error", rule: "parse", message: "卡片缺少 id" });
    if (typeof c.kind !== "string") issues.push({ level: "error", rule: "parse", message: `「${c.id}」缺少 kind` });
    if (typeof c.start !== "number" || typeof c.end !== "number") issues.push({ level: "error", rule: "parse", message: `「${c.id}」start/end 非数字` });
    if (typeof c.params !== "object" || c.params === null) issues.push({ level: "error", rule: "parse", message: `「${c.id}」params 非对象` });
    if (c.start >= c.end) issues.push({ level: "error", rule: "parse", message: `「${c.id}」start>=end` });
  }
  if (issues.length) return { error: "结构校验失败", issues };
  return { doc: raw };
}

function lintOverlay(doc, opts) {
  const cfg = LINT_DEFAULTS;
  const issues = [];
  const push = (i) => issues.push(i);
  const cards = doc.cards;

  for (const c of cards) {
    // error: 占位/示例文案残留(启发式)
    for (const [k, v] of Object.entries(c.params ?? {})) {
      if (typeof v === "string" && v !== "" && isDemoCopy(v) && /示例|占位|可空|这一行|写在这|HERE/.test(v)) {
        push({ level: "error", cardId: c.id, rule: "placeholder-text", message: `「${c.id}」(${c.kind}) 的 ${k} 疑似示例/占位文案「${v.slice(0, 18)}…」,不用就清成空字符串` });
      }
    }
    // error: 时间越界
    if (opts?.duration && c.end > opts.duration + 0.5) {
      push({ level: "error", cardId: c.id, rule: "over-duration", message: `「${c.id}」end=${c.end}s 超过视频时长 ${opts.duration}s` });
    }
    // warn: 吃人像源却无素材
    if (CAM_KINDS.has(c.kind) && !c.params?.camSrc && !doc.cam && !opts?.hasMainVideo) {
      push({ level: "warn", cardId: c.id, rule: "missing-cam", message: `「${c.id}」(${c.kind}) 没有人像素材,导出会是空框` });
    }
    // warn: 驻留过短
    if (!cfg.dwellExemptKinds.has(c.kind) && c.end - c.start < cfg.minDwell) {
      push({ level: "warn", cardId: c.id, rule: "short-dwell", message: `「${c.id}」(${c.kind}) 只驻留 ${(c.end - c.start).toFixed(1)}s(< ${cfg.minDwell}s)` });
    }
    // warn: 小数百分比
    if (cfg.warnDecimalPercent) {
      for (const [k, v] of Object.entries(c.params ?? {})) {
        if (typeof v === "string" && /\d+\.\d+\s*%/.test(v)) {
          push({ level: "warn", cardId: c.id, rule: "decimal-percent", message: `「${c.id}」的 ${k} 含精确小数「${(v.match(/\d+\.\d+\s*%/) ?? [""])[0]}」,口播取整更顺` });
          break;
        }
      }
    }
  }
  // warn: caption-track 提醒
  if (cfg.warnCaptionTrack) {
    const cap = cards.find((c) => c.kind === "caption-track");
    if (cap) push({ level: "warn", cardId: cap.id, rule: "caption-track", message: `编排里有字幕卡「${cap.id}」——先确认原片没有烧录字幕,有就删掉这张` });
  }
  // 时间重叠已放开:卡片时间窗可自由交叠(同时或交叉),不再判 stack-overlap。
  // warn: 长时间无新动作
  if (cards.length && cfg.maxQuietGap > 0) {
    const times = cards.flatMap((c) => [c.start, ...actionTimes(c)]).sort((x, y) => x - y);
    const lastEnd = Math.max(...cards.map((c) => c.end));
    times.push(lastEnd);
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      if (gap > cfg.maxQuietGap) push({ level: "warn", at: times[i - 1], rule: "quiet-gap", message: `${times[i - 1].toFixed(1)}s → ${times[i].toFixed(1)}s 之间 ${gap.toFixed(1)}s 无新动作(> ${cfg.maxQuietGap}s)` });
    }
  }
  // error: 相邻内容卡同 kind
  const content = cards.filter((c) => c.kind !== "caption-track" && c.kind !== "chapter-bar").sort((a, b) => a.start - b.start);
  for (let i = 1; i < content.length; i++) {
    if (content[i].kind === content[i - 1].kind) push({ level: "error", cardId: content[i].id, rule: "adjacent-kind", message: `「${content[i - 1].id}」与「${content[i].id}」相邻且同为 ${content[i].kind}` });
  }
  return issues;
}

// ---- main ----
const file = process.argv[2];
if (!file) { console.error("用法: node lint-overlay.mjs <overlay.json> [--duration 387.4] [--main-video]"); process.exit(2); }
const args = process.argv.slice(3);
const duration = (() => { const i = args.indexOf("--duration"); return i >= 0 ? Number(args[i + 1]) : undefined; })();
const hasMainVideo = args.includes("--main-video");
const text = readFileSync(file, "utf-8");
const { doc, error, issues: perr } = parseOverlay(text);
if (error) { console.error("解析错误:", error); if (perr) for (const i of perr) console.error(`  [${i.level}] ${i.rule}: ${i.message}`); process.exit(1); }
const issues = lintOverlay(doc, { duration, hasMainVideo });
const errs = issues.filter((i) => i.level === "error");
const warns = issues.filter((i) => i.level === "warn");
console.log(`体检结果: ${issues.length} 条 (error=${errs.length}, warn=${warns.length})`);
for (const i of issues) console.log(`  [${i.level}] ${i.rule} 卡=${i.cardId ?? "-"} @${i.at ?? "-"}: ${i.message}`);
process.exit(errs.length ? 1 : 0);
