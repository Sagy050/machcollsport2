/** Serves the original hand-written pages (public site, staff app, report) exactly as designed. */
import indexHtml from "./html/index.html?raw";
import staffHtml from "./html/staff.html?raw";
import reportHtml from "./html/report.html?raw";
import adsHtml from "./html/ads.html?raw";

const PAGES = { index: indexHtml, staff: staffHtml, report: reportHtml, ads: adsHtml } as const;
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js";

function withLive(html: string, beforeScript: string) {
  const url = import.meta.env["VITE_SUPABASE_URL"] as string;
  const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string;
  const cfg = JSON.stringify({ url, key }).replace(/</g, "\\u003c");
  const inject = `<script src="${SUPABASE_JS}"></script>\n<script>window.SD_CLOUD=${cfg};</script>\n<script src="/js/live.js"></script>\n`;
  return html.replace(beforeScript, inject + beforeScript);
}

export function page(name: keyof typeof PAGES): Response {
  let html: string = PAGES[name];
  if (name === "index") html = withLive(html, '<script src="/js/site.js">');
  if (name === "staff") html = withLive(html, '<script src="/js/staff.js">');
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...(name === "staff" ? { "Accept-CH": "Sec-CH-UA-Model" } : {}),
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    },
  });
}
