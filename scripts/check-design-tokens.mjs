#!/usr/bin/env node
/**
 * 设计 token 守卫 —— 方案 B · Precision
 * ────────────────────────────────────────────────────────────────
 * 把「圆角 / 间距 / 字号 / 过渡时长按层级统一」从口头约定变成可运行的检查。
 *
 * 用法：
 *   pnpm check:tokens            校验，有违规则 exit 1（可进 CI / pre-commit）
 *   pnpm check:tokens --report   只打印各刻度的实际分布，不判错
 *
 * 刻度定义见 src/app/styles/globals.css 的 @theme inline 注释块。
 * 这里刻意重复一份常量：守卫必须是「独立事实源」，否则改 token 时
 * 守卫会跟着一起漂，就失去意义了。改动刻度需同时改两处。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

/* ─────────────────────────────── 刻度定义 ─────────────────────────────── */

/** 间距节奏（padding / margin / gap）—— 硬性 7 档 + 2 个布局档 */
const RHYTHM_SCALE = new Set(["0", "1", "2", "3", "4", "5", "6", "8", "12", "16"]);
const RHYTHM_LABEL = "0/1/2/3/4/5/6/8/12/16  (0/4/8/12/16/20/24/32/48/64px)";

/** 圆角 —— 硬性 4 档 + full，lg 仅播放器容器 */
const RADIUS_SCALE = new Set(["none", "xs", "sm", "md", "lg", "full"]);
const RADIUS_LABEL = "none/xs/sm/md/lg/full  (0/4/6/12/16/9999px)";

/** 过渡时长 —— 3 档 */
const DURATION_SCALE = new Set(["0", "100", "150", "250"]);
const DURATION_LABEL = "0/100/150/250ms";

/** CSS 里允许出现的字面量字号（对应 --text-* 六档，12px 为硬下限） */
const CSS_FONT_SCALE = new Set([12, 13, 14, 16, 20, 24]);

/** CSS 里允许出现的字面量圆角 px（其余必须走 var(--radius-*)） */
const CSS_RADIUS_LITERALS = new Set([0, 4, 6, 12, 16, 999]);

/**
 * 宽度档位命名 —— 页面级宽度只能用这三个具名 token，
 * 其余宽度一律走整数尺寸档（max-w-96 / min-w-32）。
 * 这条规则专门拦 Tailwind 默认容器名（max-w-xs / max-w-2xl），
 * 它们是「沉默的越档」：不出错、不报警，但宽度随手写。
 */
const WIDTH_TOKENS = new Set(["narrow", "grid", "stage"]);
/** 允许的宽度关键字（非数值、非具名档） */
const WIDTH_KEYWORDS = new Set(["full", "none", "fit", "min", "max", "screen", "px", "auto", "svw", "lvw", "dvw"]);

/**
 * 图标尺寸刻度 —— lucide 的 size 属性是数字，走不到 CSS token，所以这里定义。
 *   12  与 12px 正文同高，行内图标
 *   14  次级行内图标 / 小按钮
 *   16  默认：控件内的主图标（按钮、导航、播放控制）
 *   20  强调图标 / 卡片角标
 *   24  区块标题
 *   28/32/40/48  展示型：空状态、引导页
 */
const ICON_SCALE = new Set([12, 14, 16, 20, 24, 28, 32, 40, 48]);
const ICON_LABEL = "12/14/16/20/24/28/32/40/48";

/* ─────────────────────── v3 配色 / 层级刻度 ─────────────────────── */

/**
 * Tailwind 默认调色板一律禁用。
 * 这些色是按暗底调的：emerald-500 / amber-300 / red-400 在亮色主题下
 * 对 --card 只有 2.41 / 1.41 / 2.78:1 —— 连 SC 1.4.3 的 4.5:1 一半都不到。
 * 需要状态色请用 --success / --warning / --destructive / --live。
 */
const PALETTE_NAMES =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|grey|zinc|neutral|stone";
const PALETTE_LABEL = "语义色：primary / secondary / muted / accent / destructive / live / success / warning / info";

/** 字重 —— 3 档。三者都在用，再加档就是噪音 */
const WEIGHT_SCALE = new Set(["normal", "medium", "semibold"]);
const WEIGHT_LABEL = "normal/medium/semibold (400/500/600)";

/** 阴影 —— 3 档 elevation，取代裸的 shadow-sm/md/lg */
const SHADOW_SCALE = new Set(["none", "e1", "e2", "e3"]);
const SHADOW_LABEL = "none/e1/e2/e3";

/** 层级 —— 4 档，每档一个角色（见 globals.css 的 --z-*） */
const Z_SCALE = new Set(["auto", "chrome", "stage-msg", "stage-popup", "float"]);
const Z_LABEL = "auto/chrome/stage-msg/stage-popup/float";

/** 字距 —— 2 档。wide/wider/widest 曾同时用于同一个「大写微标签」角色 */
const TRACKING_SCALE = new Set(["tight", "normal", "caps"]);
const TRACKING_LABEL = "tight(-0.02em)/normal/caps(+0.06em)";

/** 行高 —— 4 档（none 是「收起行盒」的原语，不是节奏档） */
const LEADING_SCALE = new Set(["none", "tight", "snug", "normal", "relaxed"]);
const LEADING_LABEL = "none/tight(1.25)/snug(1.4)/normal(1.5)/relaxed(1.6)";

/** 描边宽度 —— 2 档：1px 轮廓 / 2px 焦点环 */
const RING_WIDTH_SCALE = new Set(["1", "2"]);
const RING_WIDTH_LABEL = "1（轮廓）/ 2（焦点环）";

/** 元素级 opacity —— 4 档。disabled 一律 40%，装饰一律 30% */
const OPACITY_SCALE = new Set(["0", "30", "40", "60", "100"]);
const OPACITY_LABEL = "0/30/40/60/100";

/** CSS 里允许的字面量时长 */
const CSS_DURATION_SCALE = new Set([100, 150, 250]);
/** CSS 时长例外：prefers-reduced-motion 把动效压到不可感知是规范做法 */
const CSS_DURATION_EXCEPTIONS = new Map([
  ["0.01", "prefers-reduced-motion 下关闭动效（规范做法，不是设计选择）"],
]);

/**
 * 例外清单 —— 每条都必须写明「为什么它不是设计选择」。
 * 例外越少越好；新增例外等于在刻度上开口子，review 时要能说服人。
 */
const RHYTHM_EXCEPTIONS = new Map([
  [
    "pl-20",
    "macOS 红绿灯留白 80px，平台常量（Windows/Linux 走 pr-1），不参与设计刻度",
  ],
]);

/** 转义舱口：该行（或上一行）出现此标记则跳过检查。用于平台/OS 级常量。 */
const IGNORE_MARK = "@tokens-ignore";

/* ─────────────────────────────── 匹配器 ─────────────────────────────── */

const RHYTHM_PROPS =
  "p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y";
const DIM_PROPS = "size|w|h|min-w|min-h|max-w|max-h|basis";
const RADIUS_SIDES = "(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee)";

const RE_RHYTHM = new RegExp(`^-?(?:${RHYTHM_PROPS})-(\\d+(?:\\.\\d+)?)$`);
const RE_DIM = new RegExp(`^-?(?:${DIM_PROPS})-(\\d+(?:\\.\\d+)?)$`);
/** 非数值宽度：max-w-xs / w-full / min-w-fit … */
const RE_WIDTH_WORD = /^(?:max-w|min-w|w|size)-([a-z][a-z0-9]*)$/;
const RE_RADIUS = new RegExp(`^rounded(?:-${RADIUS_SIDES})?(?:-(.+))?$`);
const RE_DURATION = /^duration-(\d+)$/;
const RE_ARBITRARY = new RegExp(
  `^(?:${RHYTHM_PROPS}|${DIM_PROPS}|text|rounded|duration|leading|tracking)-\\[`,
);

/**
 * 函数式任意值（w-[min(18rem,42vw)] / h-[calc(...)] / max-w-[clamp(...)]）是
 * 响应式表达式，不是魔法数字 —— 放行。只拦 [8rem] / [13px] 这类字面量。
 */
const isFunctionalArbitrary = (base) => {
  const open = base.indexOf("[");
  return open !== -1 && /[(,]/.test(base.slice(open + 1));
};

/* ── v3 配色 / 层级匹配器 ── */
const COLOR_UTILS =
  "text|bg|border|ring|fill|stroke|from|to|via|divide|outline|decoration|placeholder|caret|shadow|accent";
const RE_PALETTE_NUM = new RegExp(`^(?:${COLOR_UTILS})-(?:${PALETTE_NAMES})-\\d{2,3}$`);
const RE_PALETTE_BARE = new RegExp(`^(?:${COLOR_UTILS})-(?:white|black)(?:/\\d+)?$`);
/** 语义 token 上的 alpha 修饰符：text-muted-foreground/60、bg-primary/12 … */
const RE_ALPHA_ON_TOKEN = new RegExp(`^(?:${COLOR_UTILS})-[a-z][\\w-]*/\\d+$`);
const RE_WEIGHT = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;
const RE_SHADOW = /^shadow-(.+)$/;
const RE_Z = /^z-(.+)$/;
const RE_TRACKING = /^tracking-(.+)$/;
const RE_LEADING = /^leading-(.+)$/;
const RE_RING_WIDTH = /^ring-(\d+)$/;
const RE_OPACITY = /^opacity-(\d+)$/;

/** 从一行里抽出所有候选 class token（去掉变体前缀、引号、JSX 花括号）
 *  注意：不能在 ( ) , 上切分 —— 否则 w-[min(18rem,42vw)] 会被切成 "w-[min"。 */
function tokenize(line) {
  const out = [];
  for (const raw of line.split(/[\s"'`{}<>=;]+/)) {
    if (!raw) continue;
    const tok = raw.replace(/[.,;]+$/, "");
    if (!tok || !/^[a-zA-Z0-9_:[\]()./%#-]+$/.test(tok)) continue;
    // 变体链：hover:focus:p-2 → 取最后一段；任意值里的冒号（如 [url(a:b)]）会被截断，
    // 但那类 token 一定带 '[' ，交给 RE_ARBITRARY 兜底，不依赖最后一段。
    const base = tok.includes(":") ? tok.slice(tok.lastIndexOf(":") + 1) : tok;
    out.push({ raw: tok, base });
  }
  return out;
}

/** 剥掉块注释，避免注释里写的示例被误判 */
function stripBlockComments(lines) {
  let inBlock = false;
  return lines.map((line) => {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) return "";
      s = s.slice(end + 2);
      inBlock = false;
    }
    let guard = 0;
    while (guard++ < 20) {
      const start = s.indexOf("/*");
      if (start === -1) break;
      const end = s.indexOf("*/", start + 2);
      if (end === -1) {
        s = s.slice(0, start);
        inBlock = true;
        break;
      }
      s = s.slice(0, start) + s.slice(end + 2);
    }
    return s;
  });
}

/* ─────────────────────────────── 文件遍历 ─────────────────────────────── */

function walk(dir, exts, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, acc);
    else if (exts.some((e) => name.endsWith(e))) acc.push(full);
  }
  return acc;
}

/* ─────────────────────────────── 检查逻辑 ─────────────────────────────── */

const violations = [];
const stats = {
  radius: new Map(),
  rhythm: new Map(),
  duration: new Map(),
  cssFont: new Map(),
  dimension: new Map(),
  width: new Map(),
  icon: new Map(),
  palette: new Map(),
  alpha: new Map(),
  weight: new Map(),
  shadow: new Map(),
  z: new Map(),
  tracking: new Map(),
  leading: new Map(),
  ringWidth: new Map(),
  opacity: new Map(),
  cssColor: new Map(),
  cssDuration: new Map(),
  boundary: new Map(),
};

const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

function report(file, line, code, message, snippet) {
  violations.push({ file: relative(ROOT, file).split(sep).join("/"), line, code, message, snippet });
}

function checkCode(file) {
  const rawLines = readFileSync(file, "utf8").split("\n");
  const lines = stripBlockComments(rawLines);

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    // 行注释
    const slash = line.indexOf("//");
    const code = slash === -1 ? line : line.slice(0, slash);
    const ignored =
      (rawLines[i] ?? "").includes(IGNORE_MARK) || (rawLines[i - 1] ?? "").includes(IGNORE_MARK);
    if (ignored) return;

    // 图标尺寸：size={N} 只允许落在图标刻度上。
    // 注意 tokenize 会把 {} 当分隔符切开，所以这条规则直接扫原始行。
    for (const im of code.matchAll(/size=\{(\d+)\}/g)) {
      const n = Number(im[1]);
      if (!ICON_SCALE.has(n)) {
        report(
          file,
          lineNo,
          "ICON_OFF_SCALE",
          `图标尺寸 size={${n}} 不在刻度上，允许：${ICON_LABEL}`,
          code.trim(),
        );
        bump(stats.icon, `${n} ✗`);
      } else {
        bump(stats.icon, String(n));
      }
    }

    /* ── 装饰性描边不能单独构成元素 ──
     * `--border` / `--border-faint` 是 1.2–1.6:1 的装饰色，只在「元素另有视觉定义」
     * （有填充、有文字、贴着相邻内容）时才成立。如果一个 className 字面量**只有**
     * 这一个 token，说明描边是该元素的全部视觉定义 —— 那就是结构性边界，必须 ≥3:1，
     * 应当改用 --input / --primary-border / --ring。GlobalSearch 的搜索框就是这么错的。
     */
    for (const bm of code.matchAll(/(["'`])(border-border(?:-faint)?)\1/g)) {
      report(
        file,
        lineNo,
        "DECORATIVE_BORDER_ALONE",
        `${bm[2]} 单独作为元素的全部样式 —— 装饰性描边（1.2–1.6:1）不能承担结构性边界`,
        code.trim(),
      );
      bump(stats.boundary, `${bm[2]} ✗`);
    }

    for (const { raw, base } of tokenize(code)) {
      let m;
      if (RE_ARBITRARY.test(base) && !isFunctionalArbitrary(base)) {
        report(file, lineNo, "ARBITRARY_VALUE", `任意值写法 ${raw}，必须使用刻度 token`, code.trim());
        continue;
      }

      /* ── v3：配色 / 层级 / 字重 / 字距 / 行高 ── */

      if (RE_PALETTE_NUM.test(base) || RE_PALETTE_BARE.test(base)) {
        report(
          file,
          lineNo,
          "PALETTE_COLOR",
          `${raw} 用了 Tailwind 默认调色板。它按暗底调，亮色主题下对比度不达标；改用 ${PALETTE_LABEL}`,
          code.trim(),
        );
        bump(stats.palette, raw.split("-").slice(1).join("-"));
        continue;
      }

      if (RE_ALPHA_ON_TOKEN.test(base)) {
        report(
          file,
          lineNo,
          "ALPHA_ON_TOKEN",
          `${raw} 给语义 token 加 alpha。透明度无法保证对比度下限，` +
            `且 /50 /55 /60 /70 在视觉上分辨不出；需要更低的对比度就换下一档 token`,
          code.trim(),
        );
        bump(stats.alpha, raw.split("-").slice(1).join("-"));
        continue;
      }

      if ((m = RE_WEIGHT.exec(base))) {
        if (!WEIGHT_SCALE.has(m[1])) {
          report(
            file,
            lineNo,
            "WEIGHT_OFF_SCALE",
            `字重 ${raw} 不在刻度上，允许：${WEIGHT_LABEL}`,
            code.trim(),
          );
          bump(stats.weight, `${m[1]} ✗`);
        } else {
          bump(stats.weight, m[1]);
        }
        continue;
      }

      if ((m = RE_SHADOW.exec(base)) && !m[1].includes("/")) {
        if (!SHADOW_SCALE.has(m[1])) {
          report(
            file,
            lineNo,
            "SHADOW_OFF_SCALE",
            `阴影 ${raw} 不在层级刻度上，允许：${SHADOW_LABEL}`,
            code.trim(),
          );
          bump(stats.shadow, `${m[1]} ✗`);
        } else {
          bump(stats.shadow, m[1]);
        }
        continue;
      }

      if ((m = RE_Z.exec(base))) {
        if (!Z_SCALE.has(m[1])) {
          report(
            file,
            lineNo,
            "Z_OFF_SCALE",
            `层级 ${raw} 不是具名档位，允许：${Z_LABEL}`,
            code.trim(),
          );
          bump(stats.z, `${m[1]} ✗`);
        } else {
          bump(stats.z, m[1]);
        }
        continue;
      }

      if ((m = RE_TRACKING.exec(base))) {
        if (!TRACKING_SCALE.has(m[1])) {
          report(
            file,
            lineNo,
            "TRACKING_OFF_SCALE",
            `字距 ${raw} 不在刻度上，允许：${TRACKING_LABEL}`,
            code.trim(),
          );
          bump(stats.tracking, `${m[1]} ✗`);
        } else {
          bump(stats.tracking, m[1]);
        }
        continue;
      }

      if ((m = RE_LEADING.exec(base))) {
        if (!LEADING_SCALE.has(m[1])) {
          report(
            file,
            lineNo,
            "LEADING_OFF_SCALE",
            `行高 ${raw} 不在刻度上，允许：${LEADING_LABEL}`,
            code.trim(),
          );
          bump(stats.leading, `${m[1]} ✗`);
        } else {
          bump(stats.leading, m[1]);
        }
        continue;
      }

      if ((m = RE_RING_WIDTH.exec(base))) {
        if (!RING_WIDTH_SCALE.has(m[1])) {
          report(
            file,
            lineNo,
            "RING_WIDTH_OFF_SCALE",
            `描边宽度 ${raw} 不在刻度上，允许：${RING_WIDTH_LABEL}`,
            code.trim(),
          );
          bump(stats.ringWidth, `${m[1]} ✗`);
        } else {
          bump(stats.ringWidth, m[1]);
        }
        continue;
      }

      if ((m = RE_OPACITY.exec(base))) {
        if (!OPACITY_SCALE.has(m[1])) {
          report(
            file,
            lineNo,
            "OPACITY_OFF_SCALE",
            `opacity ${raw} 不在刻度上，允许：${OPACITY_LABEL}（禁用一律 40，装饰一律 30）`,
            code.trim(),
          );
          bump(stats.opacity, `${m[1]} ✗`);
        } else {
          bump(stats.opacity, m[1]);
        }
        continue;
      }

      if ((m = RE_RHYTHM.exec(base))) {
        const v = m[1];
        if (v.includes(".")) {
          report(
            file,
            lineNo,
            "SPACING_FRACTION",
            `间距 ${raw} 落在 4px 网格之外（半档），只允许整数档`,
            code.trim(),
          );
        } else if (!RHYTHM_SCALE.has(v)) {
          if (RHYTHM_EXCEPTIONS.has(base)) {
            bump(stats.rhythm, `${v} (例外)`);
          } else {
            report(
              file,
              lineNo,
              "SPACING_OFF_SCALE",
              `间距 ${raw} 不在刻度上，允许：${RHYTHM_LABEL}`,
              code.trim(),
            );
            bump(stats.rhythm, `${v} ✗`);
          }
        } else {
          bump(stats.rhythm, v);
        }
        continue;
      }

      if ((m = RE_DIM.exec(base))) {
        const v = m[1];
        if (v.includes(".")) {
          report(
            file,
            lineNo,
            "DIMENSION_FRACTION",
            `尺寸 ${raw} 落在 4px 网格之外，尺寸档同样只允许整数`,
            code.trim(),
          );
        } else {
          bump(stats.dimension, v);
        }
        continue;
      }

      if ((m = RE_WIDTH_WORD.exec(base))) {
        const word = m[1];
        if (!WIDTH_TOKENS.has(word) && !WIDTH_KEYWORDS.has(word)) {
          report(
            file,
            lineNo,
            "WIDTH_OFF_SCALE",
            `宽度 ${raw} 不是具名档位（${[...WIDTH_TOKENS].join("/")}）也不是整数尺寸，` +
              `Tailwind 默认容器名一律不用`,
            code.trim(),
          );
          bump(stats.width, `${word} ✗`);
        } else if (WIDTH_TOKENS.has(word)) {
          bump(stats.width, word);
        }
        continue;
      }

      if ((m = RE_RADIUS.exec(base))) {
        const suffix = m[1];
        if (suffix === undefined) {
          report(
            file,
            lineNo,
            "RADIUS_BARE",
            `裸 rounded（=4px）不是刻度档位，请显式写 rounded-xs`,
            code.trim(),
          );
        } else if (!RADIUS_SCALE.has(suffix)) {
          report(
            file,
            lineNo,
            "RADIUS_OFF_SCALE",
            `圆角 ${raw} 不在刻度上，允许：${RADIUS_LABEL}`,
            code.trim(),
          );
          bump(stats.radius, `${suffix} ✗`);
        } else {
          bump(stats.radius, suffix);
        }
        continue;
      }

      if ((m = RE_DURATION.exec(base))) {
        if (!DURATION_SCALE.has(m[1])) {
          report(
            file,
            lineNo,
            "DURATION_OFF_SCALE",
            `过渡时长 ${raw} 不在刻度上，允许：${DURATION_LABEL}`,
            code.trim(),
          );
          bump(stats.duration, `${m[1]} ✗`);
        } else {
          bump(stats.duration, m[1]);
        }
      }
    }
  });
}

/** 扫出 JSX 开标签的结束位置 —— 跳过字符串与 {} 表达式，免得被 onChange={(e) => …} 里的 > 骗到。 */
function jsxTagEnd(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return i;
  }
  return -1;
}

/**
 * 文本输入类元素（input / textarea / select）的描边必须走 --input。
 * 它们通常没有填充，描边就是「这里能输入」的唯一视觉线索 —— SC 1.4.11 要求 ≥3:1，
 * 而 --border / --border-faint 只有 1.2–1.6:1（只配做分隔线与容器轮廓）。
 */
function checkFieldBorders(file) {
  const text = stripBlockComments(readFileSync(file, "utf8").split("\n")).join("\n");
  for (const m of text.matchAll(/<(input|textarea|select)\b/g)) {
    const end = jsxTagEnd(text, m.index);
    if (end < 0) continue;
    const tag = text.slice(m.index, end + 1);
    if (!/border-border(?:-faint)?\b/.test(tag)) continue;
    report(
      file,
      text.slice(0, m.index).split("\n").length,
      "FIELD_DECORATIVE_BORDER",
      `<${m[1]}> 用了装饰性描边（1.2–1.6:1）—— 输入类控件的描边是它的唯一识别线索，必须用 border-input`,
      tag
        .split("\n")
        .find((l) => l.includes("border-border"))
        ?.trim()
        .slice(0, 110) ?? "",
    );
    bump(stats.boundary, `<${m[1]}> ✗`);
  }
}

function checkCss(file) {
  const rawLines = readFileSync(file, "utf8").split("\n");
  const lines = stripBlockComments(rawLines);

  lines.forEach((line, i) => {
    if ((rawLines[i] ?? "").includes(IGNORE_MARK) || (rawLines[i - 1] ?? "").includes(IGNORE_MARK))
      return;
    const lineNo = i + 1;

    const fs = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(line);
    if (fs) {
      const v = Number(fs[1]);
      if (!CSS_FONT_SCALE.has(v)) {
        report(
          file,
          lineNo,
          "CSS_FONT_OFF_SCALE",
          `字号 ${v}px 不在刻度上（12/13/14/16/20/24），界面最小字号 12px`,
          line.trim(),
        );
        bump(stats.cssFont, `${v} ✗`);
      } else {
        bump(stats.cssFont, String(v));
      }
    }

    const br = /border-radius:\s*(\d+(?:\.\d+)?)px/.exec(line);
    if (br) {
      const v = Number(br[1]);
      if (!CSS_RADIUS_LITERALS.has(v)) {
        report(
          file,
          lineNo,
          "CSS_RADIUS_LITERAL",
          `字面量圆角 ${v}px 不在刻度上，请改用 var(--radius-*)（0/4/6/12/16/999 除外）`,
          line.trim(),
        );
      }
    }

    /* 颜色字面量 —— 只有自定义属性定义行可以写。
       CSS 里散落的 oklch()/#hex 是最难发现的一类漂移：
       它们不进任何 token 统计，主题切换时也不跟着走。 */
    const isTokenDef = /^\s*--[\w-]+\s*:/.test(line);
    if (!isTokenDef) {
      const lit = /#[0-9a-fA-F]{3,8}\b/.exec(line) ?? /\b(?:oklch|rgba?|hsla?)\(/.exec(line);
      if (lit) {
        report(
          file,
          lineNo,
          "CSS_COLOR_LITERAL",
          `CSS 里出现字面量颜色 ${lit[0]}，请先定义 token 再走 var()`,
          line.trim(),
        );
        bump(stats.cssColor, lit[0]);
      }
    }

    /* 时长字面量 —— 只允许 100/150/250ms，其余走 var(--t-*) */
    for (const dm of line.matchAll(/(\d+(?:\.\d+)?)ms\b/g)) {
      const v = Number(dm[1]);
      if (CSS_DURATION_SCALE.has(v)) {
        bump(stats.cssDuration, String(v));
      } else if (CSS_DURATION_EXCEPTIONS.has(dm[1])) {
        bump(stats.cssDuration, `${dm[1]} (例外)`);
      } else {
        report(
          file,
          lineNo,
          "CSS_DURATION_OFF_SCALE",
          `时长 ${dm[1]}ms 不在刻度上（100/150/250），请用 var(--t-fast / --t-base / --t-slow)`,
          line.trim(),
        );
        bump(stats.cssDuration, `${dm[1]} ✗`);
      }
    }
  });
}

/* ───────────── 未分层规则 vs @layer utilities（静默失效的一类）─────────────
 * 未分层（不在任何 @layer 里）的声明优先级**高于** @layer utilities —— 这是
 * CSS Cascade Layers 规范定的，与选择器权重无关。所以 globals.css 里一条裸的
 * `button, input { font: inherit }` 能把所有 <button>/<input> 上的 text-xs /
 * text-sm / text-2xl 全部压掉。
 *
 * 这类失效的可怕之处在于它完全静默：类名在 DOM 上、样式表里也生成了，
 * 算出来却是继承值。没有报错、没有警告，只有「怎么没生效」。
 * 真实代价：播放器 Live 徽章因此是 29px 而不是设计的 20px。
 *
 * 这里只查「裸类型选择器 + 排版属性」这一组合 —— 它是唯一会造成静默
 * 排版漂移的形态，误报为零。类选择器（.ctrl-btn 等）不受影响。
 */

/** 解析 CSS 规则并记录每条规则所处的 @layer 栈。够用即可，globals.css 是手写的。 */
function parseCssRules(css) {
  const rules = [];
  const stack = [];
  const lineAt = (idx) => (css.slice(0, idx).match(/\n/g) ?? []).length + 1;
  let buf = "";

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];

    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 1;
      continue;
    }
    if (ch === ";") {
      buf = "";
      continue;
    }
    if (ch === "}") {
      stack.pop();
      buf = "";
      continue;
    }
    if (ch !== "{") {
      buf += ch;
      continue;
    }

    const head = buf.trim().replace(/\s+/g, " ");
    buf = "";

    if (head.startsWith("@")) {
      stack.push(head);
      continue;
    }

    // 选择器规则：整段 body 跳过，避免把声明里的 {} 当成作用域
    let depth = 1;
    let j = i + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      if (depth === 0) break;
      j++;
    }
    rules.push({
      selector: head,
      line: lineAt(i),
      body: css.slice(i + 1, j),
      layers: stack.filter((s) => s.startsWith("@layer")),
    });
    i = j;
  }
  return rules;
}

/** 选择器里出现裸的 button / input / select / textarea（`.btn` 这类不算） */
const targetsFormControl = (selector) =>
  selector
    .split(",")
    .some((part) => /(?:^|[\s>+~])(?:button|input|select|textarea)\b/.test(part.trim()));

/** 会造成排版漂移的属性 */
const FONT_DECL = /\bfont(?:-size|-family|-weight|-style|-variant)?\s*:|\bline-height\s*:/;

function checkCssCascade(file) {
  for (const rule of parseCssRules(readFileSync(file, "utf8"))) {
    if (rule.layers.length > 0) continue;
    if (!targetsFormControl(rule.selector)) continue;
    if (!FONT_DECL.test(rule.body)) continue;
    report(
      file,
      rule.line,
      "UNLAYERED_FORM_FONT",
      `未分层的 \`${rule.selector}\` 设置了排版属性，会压过 @layer utilities 里的 text-*，` +
        `让 <button>/<input> 上的字号静默失效。请删掉（preflight 已在 @layer base 里处理），` +
        `或改写成类选择器。`,
      rule.selector,
    );
  }
}

/* ─────────────────────────────── 输出 ─────────────────────────────── */

function fmtMap(map, order) {
  const keys = [...map.keys()].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return (Number.parseFloat(a) || 0) - (Number.parseFloat(b) || 0);
  });
  return keys.map((k) => `${k}×${map.get(k)}`).join("  ");
}

/* ─────────────── 边界 / 状态对比度断言（WCAG 2.2 SC 1.4.11） ───────────────
 * 「用来识别控件的视觉信息」必须 ≥3:1。--input / --primary-border / --ring
 * 都属于这类角色：一旦有人为了「看起来轻一点」把明度调浅，控件会静默变得
 * 不可辨识，而任何语法层检查都发现不了。所以这里直接把 oklch 换算成
 * WCAG 对比度来断言，把「为什么是这个明度」变成可执行的约束。
 *
 * 换算要点：oklch → sRGB 的矩阵输出的是**线性** sRGB，算亮度时不能再做一次
 * gamma 解码（这个坑踩过两次）。alpha 合成发生在已编码的 sRGB 空间。
 *
 * ⚠️ 块切片不能靠 `indexOf("/*")` 之类的标记找结尾 —— 块内注释会提前截断切片，
 * 导致暗色 token 静默回落到亮色值，两个主题算出同一个色（踩过）。
 */
const CONTRAST_CSS = readFileSync(join(SRC, "app", "styles", "globals.css"), "utf8");

function cssBlock(marker) {
  const lines = CONTRAST_CSS.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${marker} {`));
  if (start < 0) throw new Error(`对比度断言：找不到 ${marker} 块`);
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    depth += (lines[i].match(/{/g) ?? []).length - (lines[i].match(/}/g) ?? []).length;
    if (depth === 0 && i > start) return lines.slice(start, i + 1).join("\n");
  }
  throw new Error(`对比度断言：${marker} 块没有闭合`);
}

function parseOklchTokens(text, base = new Map()) {
  const out = new Map(base);
  const aliases = new Map();
  for (const m of text.matchAll(/--([\w-]+)\s*:\s*var\(--([\w-]+)\)/g)) aliases.set(m[1], m[2]);
  for (const m of text.matchAll(/--([\w-]+)\s*:\s*oklch\(([^)]+)\)/g)) {
    const parts = m[2].replace("/", " ").trim().split(/\s+/);
    const v = parts.map((p) => (p.endsWith("%") ? Number.parseFloat(p) / 100 : Number.parseFloat(p)));
    if (v.length < 3 || v.slice(0, 3).some(Number.isNaN)) continue;
    const a = v.length > 3 ? (v[3] <= 1 ? v[3] : v[3] / 100) : 1;
    out.set(m[1], [v[0], v[1], v[2], a]);
  }
  for (const [alias, target] of aliases) if (out.has(target)) out.set(alias, out.get(target));
  return out;
}

function oklchToLinear(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.min(1, Math.max(0, c)));
}

const relLum = (t) => 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
function wcagContrast(a, b) {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const toLinear = (t, tokens) => oklchToLinear(t[0], t[1], t[2]);

const LIGHT_TOKENS = parseOklchTokens(cssBlock(":root"));
const DARK_TOKENS = parseOklchTokens(cssBlock(".dark"), LIGHT_TOKENS);
if (LIGHT_TOKENS.get("background")?.[0] === DARK_TOKENS.get("background")?.[0]) {
  throw new Error("对比度断言：亮/暗 background 相同，说明块切片或别名解析错了");
}

/** [前景 token, 背景 token, 最低比值, 说明] */
const BOUNDARY_ASSERTIONS = [
  ["input", "card", 3, "文本输入框边界（Input 组件落在 card 上）"],
  ["input", "background", 3, "文本输入框边界（顶栏搜索框落在 background 上）"],
  ["primary-border", "background", 3, "选中态描边（设置 / 引导 / 分类 chip）"],
  ["primary-border", "card", 3, "选中态描边（落在 card 上）"],
  ["ring", "background", 3, "聚焦环"],
  ["ring", "card", 3, "聚焦环（落在 card 上）"],
];

const contrastRows = [];
for (const [themeName, tokens] of [["亮色", LIGHT_TOKENS], ["暗色", DARK_TOKENS]]) {
  for (const [fg, bg, min, label] of BOUNDARY_ASSERTIONS) {
    const ft = tokens.get(fg);
    const bt = tokens.get(bg);
    if (!ft || !bt) {
      violations.push({
        file: "src/app/styles/globals.css",
        line: 0,
        code: "BOUNDARY_TOKEN_MISSING",
        message: `${themeName}主题缺少 --${ft ? bg : fg}`,
        snippet: label,
      });
      continue;
    }
    const ratio = wcagContrast(toLinear(ft, tokens), toLinear(bt, tokens));
    contrastRows.push({ themeName, fg, bg, ratio, min, label });
    if (ratio < min - 0.005) {
      violations.push({
        file: "src/app/styles/globals.css",
        line: 0,
        code: "BOUNDARY_CONTRAST",
        message: `${themeName}主题 --${fg} vs --${bg} = ${ratio.toFixed(2)}:1，低于 ${min}:1（${label}）`,
        snippet: "边界是识别该控件的唯一视觉线索时必须 ≥3:1 —— WCAG 2.2 SC 1.4.11",
      });
    }
  }
}

/* ── 边界 token 的可见性由上面的断言保证；下面两条管「用对了没有」──
 * 静态检查查不到「某个容器其实是文本框的边框」这种语义（GlobalSearch 的搜索框
 * 就是把描边画在包裹它的 <form> 上），所以那类情况只能靠人工走查 —— 这里只做
 * 能精确判定的部分，不为了覆盖率编造误报。
 */

const REPORT_ONLY = process.argv.includes("--report");

const tsFiles = walk(SRC, [".ts", ".tsx"]);
const cssFiles = walk(SRC, [".css"]);

for (const f of tsFiles) {
  checkCode(f);
  checkFieldBorders(f);
}
for (const f of cssFiles) {
  checkCss(f);
  checkCssCascade(f);
}

console.log(`\n  设计 token 检查 · 方案 B · Precision`);
console.log(`  扫描 ${tsFiles.length} 个 ts/tsx + ${cssFiles.length} 个 css\n`);

console.log("  ── 实际分布 ──");
console.log(`  圆角    ${fmtMap(stats.radius, ["none", "xs", "sm", "md", "lg", "full"])}`);
console.log(`  间距    ${fmtMap(stats.rhythm, ["0", "1", "2", "3", "4", "5", "6", "8", "12", "16"])}`);
console.log(`  时长    ${fmtMap(stats.duration, ["0", "100", "150", "250"])}`);
console.log(`  CSS字号 ${fmtMap(stats.cssFont, ["12", "13", "14", "16", "20", "24"])}`);
console.log(`  宽度档  ${fmtMap(stats.width, ["narrow", "grid", "stage"])}`);
console.log(
  `  图标    ${fmtMap(stats.icon, ["12", "14", "16", "20", "24", "28", "32", "40", "48"])}`,
);
console.log(
  `  尺寸档  ${fmtMap(stats.dimension, []).split("  ").slice(0, 18).join("  ")}${stats.dimension.size > 18 ? "  …" : ""}`,
);
console.log("  ── v3 配色 / 层级 ──");
console.log(`  调色板  ${fmtMap(stats.palette, []) || "（0，全部走语义 token）"}`);
console.log(`  alpha   ${fmtMap(stats.alpha, []) || "（0，全部走具名档位）"}`);
console.log(`  字重    ${fmtMap(stats.weight, ["normal", "medium", "semibold"])}`);
console.log(`  阴影    ${fmtMap(stats.shadow, ["none", "e1", "e2", "e3"])}`);
console.log(`  层级    ${fmtMap(stats.z, ["auto", "chrome", "stage-msg", "stage-popup", "float"])}`);
console.log(`  字距    ${fmtMap(stats.tracking, ["tight", "normal", "caps"])}`);
console.log(`  行高    ${fmtMap(stats.leading, ["none", "tight", "snug", "normal", "relaxed"])}`);
console.log(`  描边宽  ${fmtMap(stats.ringWidth, ["1", "2"])}`);
console.log(`  opacity ${fmtMap(stats.opacity, ["0", "30", "40", "60", "100"])}`);
console.log(`  CSS色   ${fmtMap(stats.cssColor, []) || "（0，全部走 var()）"}`);
console.log(
  `  CSS时长 ${fmtMap(stats.cssDuration, ["100", "150", "250"]) || "（无字面量）"}`,
);
console.log(`  边界    ${fmtMap(stats.boundary, []) || "（0，输入框/选中态都用了 ≥3:1 的 token）"}`);
console.log("  ── 边界对比度实测（WCAG 2.2 SC 1.4.11，阈值 3:1）──");
for (const [themeName, tokens] of [
  ["亮色", LIGHT_TOKENS],
  ["暗色", DARK_TOKENS],
]) {
  for (const [fg, bg] of [
    ["input", "background"],
    ["input", "card"],
    ["primary-border", "background"],
    ["ring", "background"],
  ]) {
    const ft = tokens.get(fg);
    const bt = tokens.get(bg);
    if (!ft || !bt) continue;
    const r = wcagContrast(toLinear(ft, tokens), toLinear(bt, tokens));
    console.log(
      `  ${themeName} --${fg.padEnd(15)} vs --${bg.padEnd(11)} ${r.toFixed(2).padStart(5)}:1  ${r >= 3 ? "✓" : "✗"}`,
    );
  }
}
console.log();

if (REPORT_ONLY) {
  console.log("  (--report 模式，不判错)\n");
  process.exit(0);
}

if (violations.length === 0) {
  console.log("  ✓ 全部通过，0 违规\n");
  process.exit(0);
}

const byFile = new Map();
for (const v of violations) {
  if (!byFile.has(v.file)) byFile.set(v.file, []);
  byFile.get(v.file).push(v);
}

console.log(`  ✗ ${violations.length} 处违规，分布在 ${byFile.size} 个文件：\n`);
for (const [file, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${file}  (${list.length})`);
  for (const v of list) {
    console.log(`    ${String(v.line).padStart(4)}  [${v.code}] ${v.message}`);
    console.log(`          ${v.snippet.slice(0, 110)}`);
  }
  console.log();
}

console.log("  刻度定义见 src/app/styles/globals.css。");
console.log("  平台/OS 级常量请在行尾或上一行加 @tokens-ignore 注释说明原因。\n");
process.exit(1);
