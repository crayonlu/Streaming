#!/usr/bin/env node
/**
 * Design token guard — Plan B · Precision
 * ────────────────────────────────────────────────────────────────
 * Turns "radius / spacing / font-size / transition-duration unified per tier"
 * from a verbal convention into an executable check.
 *
 * Usage:
 *   pnpm check:tokens            verify; exit 1 on violations (CI / pre-commit ready)
 *   pnpm check:tokens --report   only print the actual distribution per scale, no verdict
 *
 * Scale definitions live in the @theme inline comment block in src/app/styles/globals.css.
 * The constants are duplicated here on purpose: the guard must be an independent source of
 * truth, otherwise it drifts along with the tokens the moment they change and stops meaning
 * anything. Changing a scale means editing both places.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

/* ─────────────────────────────── Scale definitions ─────────────────────────────── */

/** Spacing rhythm (padding / margin / gap) — 7 hard tiers + 2 layout tiers */
const RHYTHM_SCALE = new Set(["0", "1", "2", "3", "4", "5", "6", "8", "12", "16"]);
const RHYTHM_LABEL = "0/1/2/3/4/5/6/8/12/16  (0/4/8/12/16/20/24/32/48/64px)";

/** Radius — 4 hard tiers + full; lg is player container only */
const RADIUS_SCALE = new Set(["none", "xs", "sm", "md", "lg", "full"]);
const RADIUS_LABEL = "none/xs/sm/md/lg/full  (0/4/6/12/16/9999px)";

/** Transition duration — 3 tiers */
const DURATION_SCALE = new Set(["0", "100", "150", "250"]);
const DURATION_LABEL = "0/100/150/250ms";

/** Literal font sizes allowed in CSS (mirrors the six --text-* tiers; 12px is a hard floor) */
const CSS_FONT_SCALE = new Set([12, 13, 14, 16, 20, 24]);

/** Literal radius px allowed in CSS (everything else must go through var(--radius-*)) */
const CSS_RADIUS_LITERALS = new Set([0, 4, 6, 12, 16, 999]);

/**
 * Named width tiers — page-level widths may only use these three tokens;
 * every other width goes through integer size tiers (max-w-96 / min-w-32).
 * This rule specifically blocks Tailwind's default container names
 * (max-w-xs / max-w-2xl): they are silent tier escapes — no error, no warning,
 * just widths written down ad hoc.
 */
const WIDTH_TOKENS = new Set(["narrow", "grid", "stage"]);
/** Allowed width keywords (non-numeric, non-named-tier) */
const WIDTH_KEYWORDS = new Set(["full", "none", "fit", "min", "max", "screen", "px", "auto", "svw", "lvw", "dvw"]);

/**
 * Icon size scale — lucide's size prop is a number and never reaches a CSS token,
 * so it is defined here.
 *   12  same height as 12px body text, inline icon
 *   14  secondary inline icon / small button
 *   16  default: primary icon inside a control (button, nav, playback controls)
 *   20  emphasis icon / card corner badge
 *   24  section heading
 *   28/32/40/48  display: empty states, onboarding
 */
const ICON_SCALE = new Set([12, 14, 16, 20, 24, 28, 32, 40, 48]);
const ICON_LABEL = "12/14/16/20/24/28/32/40/48";

/* ─────────────────────── v3 palette / tier scales ─────────────────────── */

/**
 * Tailwind's default palette is banned outright.
 * These colors were tuned against a dark surface: emerald-500 / amber-300 / red-400
 * reach only 2.41 / 1.41 / 2.78:1 against --card under the light theme — not even
 * half of the 4.5:1 that SC 1.4.3 requires.
 * For status colors use --success / --warning / --destructive / --live.
 */
const PALETTE_NAMES =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|grey|zinc|neutral|stone";
const PALETTE_LABEL = "语义色：primary / secondary / muted / accent / destructive / live / success / warning / info";

/** Font weight — 3 tiers. All three are in use; a fourth tier would be noise */
const WEIGHT_SCALE = new Set(["normal", "medium", "semibold"]);
const WEIGHT_LABEL = "normal/medium/semibold (400/500/600)";

/** Shadow — 3 elevation tiers, replacing bare shadow-sm/md/lg */
const SHADOW_SCALE = new Set(["none", "e1", "e2", "e3"]);
const SHADOW_LABEL = "none/e1/e2/e3";

/** Layer — 4 tiers, one role each (see --z-* in globals.css) */
const Z_SCALE = new Set(["auto", "chrome", "stage-msg", "stage-popup", "float"]);
const Z_LABEL = "auto/chrome/stage-msg/stage-popup/float";

/** Tracking — 2 tiers. wide/wider/widest were once all used for the same "caps micro-label" role */
const TRACKING_SCALE = new Set(["tight", "normal", "caps"]);
const TRACKING_LABEL = "tight(-0.02em)/normal/caps(+0.06em)";

/** Leading — 4 tiers (none is a "collapse the line box" primitive, not a rhythm tier) */
const LEADING_SCALE = new Set(["none", "tight", "snug", "normal", "relaxed"]);
const LEADING_LABEL = "none/tight(1.25)/snug(1.4)/normal(1.5)/relaxed(1.6)";

/** Ring width — 2 tiers: 1px outline / 2px focus ring */
const RING_WIDTH_SCALE = new Set(["1", "2"]);
const RING_WIDTH_LABEL = "1（轮廓）/ 2（焦点环）";

/** Element-level opacity — 4 tiers. disabled is always 40%, decorative always 30% */
const OPACITY_SCALE = new Set(["0", "30", "40", "60", "100"]);
const OPACITY_LABEL = "0/30/40/60/100";

/** Literal durations allowed in CSS */
const CSS_DURATION_SCALE = new Set([100, 150, 250]);
/** CSS duration exception: crushing motion to imperceptible under prefers-reduced-motion is standard practice */
const CSS_DURATION_EXCEPTIONS = new Map([
  ["0.01", "prefers-reduced-motion 下关闭动效（规范做法，不是设计选择）"],
]);

/**
 * Exception list — every entry must state why it is not a design choice.
 * The fewer exceptions the better; a new exception punches a hole in the scale,
 * so it has to survive review.
 */
const RHYTHM_EXCEPTIONS = new Map([
  [
    "pl-20",
    "macOS 红绿灯留白 80px，平台常量（Windows/Linux 走 pr-1），不参与设计刻度",
  ],
]);

/** Escape hatch: a line (or the one above it) carrying this marker is skipped. For platform/OS-level constants. */
const IGNORE_MARK = "@tokens-ignore";

/* ─────────────────────────────── Matchers ─────────────────────────────── */

const RHYTHM_PROPS =
  "p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y";
const DIM_PROPS = "size|w|h|min-w|min-h|max-w|max-h|basis";
const RADIUS_SIDES = "(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee)";

const RE_RHYTHM = new RegExp(`^-?(?:${RHYTHM_PROPS})-(\\d+(?:\\.\\d+)?)$`);
const RE_DIM = new RegExp(`^-?(?:${DIM_PROPS})-(\\d+(?:\\.\\d+)?)$`);
/** Non-numeric width: max-w-xs / w-full / min-w-fit … */
const RE_WIDTH_WORD = /^(?:max-w|min-w|w|size)-([a-z][a-z0-9]*)$/;
const RE_RADIUS = new RegExp(`^rounded(?:-${RADIUS_SIDES})?(?:-(.+))?$`);
const RE_DURATION = /^duration-(\d+)$/;
const RE_ARBITRARY = new RegExp(
  `^(?:${RHYTHM_PROPS}|${DIM_PROPS}|text|rounded|duration|leading|tracking)-\\[`,
);

/**
 * Functional arbitrary values (w-[min(18rem,42vw)] / h-[calc(...)] / max-w-[clamp(...)])
 * are responsive expressions, not magic numbers — allowed. Only literals like
 * [8rem] / [13px] are blocked.
 */
const isFunctionalArbitrary = (base) => {
  const open = base.indexOf("[");
  return open !== -1 && /[(,]/.test(base.slice(open + 1));
};

/* ── v3 palette / tier matchers ── */
const COLOR_UTILS =
  "text|bg|border|ring|fill|stroke|from|to|via|divide|outline|decoration|placeholder|caret|shadow|accent";
const RE_PALETTE_NUM = new RegExp(`^(?:${COLOR_UTILS})-(?:${PALETTE_NAMES})-\\d{2,3}$`);
const RE_PALETTE_BARE = new RegExp(`^(?:${COLOR_UTILS})-(?:white|black)(?:/\\d+)?$`);
/** Alpha modifier on a semantic token: text-muted-foreground/60, bg-primary/12 … */
const RE_ALPHA_ON_TOKEN = new RegExp(`^(?:${COLOR_UTILS})-[a-z][\\w-]*/\\d+$`);
const RE_WEIGHT = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;
const RE_SHADOW = /^shadow-(.+)$/;
const RE_Z = /^z-(.+)$/;
const RE_TRACKING = /^tracking-(.+)$/;
const RE_LEADING = /^leading-(.+)$/;
const RE_RING_WIDTH = /^ring-(\d+)$/;
const RE_OPACITY = /^opacity-(\d+)$/;

/** Pulls every candidate class token out of a line (strips variant prefixes, quotes, JSX braces)
 *  Note: never split on ( ) , — otherwise w-[min(18rem,42vw)] would be cut into "w-[min". */
function tokenize(line) {
  const out = [];
  for (const raw of line.split(/[\s"'`{}<>=;]+/)) {
    if (!raw) continue;
    const tok = raw.replace(/[.,;]+$/, "");
    if (!tok || !/^[a-zA-Z0-9_:[\]()./%#-]+$/.test(tok)) continue;
    // Variant chain: hover:focus:p-2 → take the last segment; colons inside arbitrary
    // values (e.g. [url(a:b)]) get truncated, but those tokens always carry '[' and fall
    // back to RE_ARBITRARY, so the last segment is not load-bearing here.
    const base = tok.includes(":") ? tok.slice(tok.lastIndexOf(":") + 1) : tok;
    out.push({ raw: tok, base });
  }
  return out;
}

/** Strips block comments so examples written inside comments are not misjudged */
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

/* ─────────────────────────────── File walk ─────────────────────────────── */

function walk(dir, exts, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, acc);
    else if (exts.some((e) => name.endsWith(e))) acc.push(full);
  }
  return acc;
}

/* ─────────────────────────────── Check logic ─────────────────────────────── */

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
    // Line comment
    const slash = line.indexOf("//");
    const code = slash === -1 ? line : line.slice(0, slash);
    const ignored =
      (rawLines[i] ?? "").includes(IGNORE_MARK) || (rawLines[i - 1] ?? "").includes(IGNORE_MARK);
    if (ignored) return;

    // Icon size: size={N} may only land on the icon scale.
    // Note tokenize splits on {} as a delimiter, so this rule scans the raw line directly.
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

    /* ── A decorative border must not constitute an element on its own ──
     * `--border` / `--border-faint` are 1.2–1.6:1 decorative colors, valid only when
     * "the element is visually defined by something else" (has a fill, has text, sits
     * against adjacent content). If a className literal contains **only** this one
     * token, the border is the element's entire visual definition — that is a structural
     * boundary and must be ≥3:1; use --input / --primary-border / --ring instead.
     * GlobalSearch's search box got this wrong exactly this way.
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

      /* ── v3: palette / tier / weight / tracking / leading ── */

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

/** Finds the end of a JSX opening tag — skips strings and {} expressions so the > in
 *  onChange={(e) => …} cannot fool it. */
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
 * Text input elements (input / textarea / select) must take their border from --input.
 * They usually have no fill, so the border is the only visual cue that "you can type
 * here" — SC 1.4.11 requires ≥3:1, while --border / --border-faint sit at 1.2–1.6:1
 * (good enough only for dividers and container outlines).
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

    /* Color literals — only custom property definition lines may carry them.
       oklch()/#hex scattered through CSS is the hardest kind of drift to spot:
       they never enter any token statistic and do not follow a theme switch. */
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

    /* Duration literals — only 100/150/250ms; anything else goes through var(--t-*) */
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

/* ───────────── Unlayered rules vs @layer utilities (the silent-failure class) ─────────────
 * An unlayered declaration (outside every @layer) ranks **higher** than @layer utilities —
 * that is what the CSS Cascade Layers spec says, independent of selector specificity. So a
 * bare `button, input { font: inherit }` in globals.css can wipe out text-xs / text-sm /
 * text-2xl on every <button>/<input>.
 *
 * What makes this class of failure scary is that it is completely silent: the class name is
 * on the DOM, the rule is generated in the stylesheet, and yet the computed value is the
 * inherited one. No error, no warning, just "why isn't it working".
 * Real cost: the player's Live badge was 29px instead of the designed 20px because of this.
 *
 * Only the "bare type selector + typography property" combination is checked here — it is
 * the one shape that causes silent typography drift, and it has zero false positives.
 * Class selectors (.ctrl-btn etc.) are unaffected.
 */

/** Parses CSS rules and records the @layer stack each rule sits in. Good enough — globals.css is hand-written. */
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

    // Selector rule: skip the whole body so {} inside declarations is not read as a scope
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

/** Bare button / input / select / textarea in a selector (`.btn` and friends do not count) */
const targetsFormControl = (selector) =>
  selector
    .split(",")
    .some((part) => /(?:^|[\s>+~])(?:button|input|select|textarea)\b/.test(part.trim()));

/** Properties that cause typography drift */
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

/* ─────────────────────────────── Output ─────────────────────────────── */

function fmtMap(map, order) {
  const keys = [...map.keys()].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return (Number.parseFloat(a) || 0) - (Number.parseFloat(b) || 0);
  });
  return keys.map((k) => `${k}×${map.get(k)}`).join("  ");
}

/* ─────────────── Boundary / state contrast assertions (WCAG 2.2 SC 1.4.11) ───────────────
 * "Visual information required to identify a control" must be ≥3:1. --input,
 * --primary-border and --ring all play that role: the moment someone lightens the
 * lightness to make it "feel lighter", the control silently becomes unidentifiable and no
 * syntactic check can catch it. So oklch is converted straight into a WCAG contrast ratio
 * here, turning "why this lightness" into an executable constraint.
 *
 * Conversion caveat: the oklch → sRGB matrix outputs **linear** sRGB, so luminance must not
 * be gamma-decoded a second time (this trap was hit twice). Alpha compositing happens in
 * already-encoded sRGB space.
 *
 * ⚠️ Block slicing must not hunt for a terminator via something like `indexOf("/*")` — comments
 * inside the block truncate the slice early, making dark tokens silently fall back to light
 * values so both themes compute the same color (hit before).
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

/** [foreground token, background token, minimum ratio, note] */
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

/* ── The assertions above guarantee the boundary tokens are visible;
 * the two rules below govern whether they are used correctly ──
 * A static check cannot see semantics like "this container is really the text field's
 * border" (GlobalSearch's search box paints its border on the wrapping <form>), so those
 * cases need a human pass — only the parts that can be judged exactly are checked here,
 * and no false positives are invented for the sake of coverage.
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
