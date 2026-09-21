/**
 * Dev-only probe: long-run Douyu FLV delivery measurement.
 * Tracks every inter-chunk gap over minutes and reports:
 *   - the distribution of stalls (gaps > 300ms / 1s / 3s)
 *   - whether the connection dies, when, and how long since the last byte
 * Deleted after use.
 */
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";

const rid = process.argv[2] ?? "9616398";
const OUT = process.argv[4];
const WINDOW_MS = Number(process.argv[3] ?? 180_000);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const cryptojs = fs.readFileSync("src-tauri/src/platforms/douyu/cryptojs.min.js", "utf8");

const h5 = await (
  await fetch(`https://www.douyu.com/swf_api/homeH5Enc?rids=${rid}`, { headers: { "User-Agent": UA } })
).json();
const ctx = {
  console, Math, Date, JSON, window: {}, navigator: { userAgent: UA },
  document: { cookie: "" }, setTimeout, setInterval, clearInterval,
};
vm.createContext(ctx);
vm.runInContext(cryptojs, ctx);
vm.runInContext(h5.data[`room${rid}`], ctx);
const ts = Math.floor(Date.now() / 1000);
const params = vm.runInContext(
  `ub98484234(${JSON.stringify(rid)}, "10000000000000000000000000001501", ${ts});`,
  ctx,
);

const res = await fetch(`https://www.douyu.com/lapi/live/getH5Play/${rid}`, {
  method: "POST",
  headers: {
    "User-Agent": UA,
    Referer: `https://www.douyu.com/${rid}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: `${params}&cdn=&rate=0&ver=Douyu_223061205&iar=1&ive=1&hevc=0&fa=0&ismix=0`,
});
const d = (await res.json()).data;
const url = d.rtmp_url + "/" + d.rtmp_live.replaceAll("&amp;", "&");
console.log(`room ${rid} rate=${d.rate} cdn=${d.rtmp_cdn} is_mixed=${d.is_mixed}`);
if (OUT) fs.writeFileSync(OUT, url);
console.log("url:", url.slice(0, 70) + "...");

if (OUT) { console.log("url written to", OUT); process.exit(0); }
const stream = await fetch(url, {
  headers: { "User-Agent": UA, Referer: "https://www.douyu.com/" },
});
console.log("stream status:", stream.status);
if (stream.status !== 200) process.exit(1);

const reader = stream.body.getReader();
const start = performance.now();
const gaps = [];
let last = start;
let total = 0;
let outcome = "window elapsed";

while (true) {
  try {
    const { done, value } = await reader.read();
    if (done) {
      outcome = "server closed stream";
      break;
    }
    const now = performance.now();
    gaps.push(Math.round(now - last));
    total += value.length;
    last = now;
    if (now - start > WINDOW_MS) break;
  } catch (e) {
    outcome = `READ ERROR: ${e.cause?.code ?? e.code ?? e.name} after ${Math.round(
      performance.now() - last,
    )}ms without data (total gap since last byte: ${Math.round(performance.now() - last)}ms)`;
    break;
  }
}
const secs = (performance.now() - start) / 1000;
const sorted = [...gaps].sort((a, b) => b - a);
const p99 = sorted[Math.floor(sorted.length * 0.01)];
const over = (ms) => gaps.filter((g) => g > ms);
console.log(`\n== ${secs.toFixed(1)}s, ${total} bytes (${Math.round(total / secs / 1024)} KB/s), ${gaps.length} chunks`);
console.log(`gaps: max=${Math.max(...gaps)}ms p99=${p99}ms mean=${Math.round(gaps.reduce((a, b) => a + b) / gaps.length)}ms`);
for (const ms of [300, 500, 1000, 2000, 5000]) {
  const list = over(ms);
  console.log(`  gaps > ${ms}ms: ${list.length}${list.length ? " -> " + list.slice(0, 8).join(",") : ""}`);
}
console.log("OUTCOME:", outcome, "| last byte at t=", Math.round(last - start), "ms");
