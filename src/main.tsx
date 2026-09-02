import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./app/styles/globals.css";
import { installHevcCodecShim } from "./shared/lib/hevc";
import { isMac } from "./shared/lib/os";

// Tag the platform on <html> so CSS can branch (e.g. skip rounded corners on
// macOS where native decorations are used).
if (isMac) document.documentElement.classList.add("is-mac");

// Rewrite hev1→hvc1 codec probes on WebView2 builds that only accept hvc1,
// so hls.js/mpegts.js can play HEVC streams there.
installHevcCodecShim();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
