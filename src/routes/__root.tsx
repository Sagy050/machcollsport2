import { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, HeadContent, Scripts, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { reportLovableError } from "../lib/lovable-error-reporting";

// The real pages (/, /staff, /report) are the original hand-written HTML served by their routes.
// This shell only renders the "not found" and error screens, in the same style as those pages.
const shell =
  "min-h-screen flex items-center justify-center px-4 text-center font-[Figtree,system-ui,sans-serif]";

function NotFoundComponent() {
  return (
    <div className={shell} style={{ background: "#0a1f3d", color: "#fff" }}>
      <div>
        <img src="/img/crest.png" alt="" width={72} height={72} style={{ margin: "0 auto 16px" }} />
        <h1 style={{ fontFamily: '"Big Shoulders Display", Impact, sans-serif', fontSize: 56, fontWeight: 900, margin: 0 }}>Page not found</h1>
        <p style={{ opacity: 0.8 }}>That page does not exist.</p>
        <p>
          <a href="/" style={{ color: "#ffc233" }}>Live results</a> · <a href="/staff" style={{ color: "#ffc233" }}>Staff sign-in</a>
        </p>
      </div>
    </div>
  );
}

function ErrorComponent({ error }: ErrorComponentProps) {
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className={shell} style={{ background: "#0a1f3d", color: "#fff" }}>
      <div>
        <h1 style={{ fontSize: 28 }}>This page didn't load</h1>
        <p>
          <a href="/" style={{ color: "#ffc233" }}>Back to live results</a>
        </p>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Machabeng College Inter-House Sports Day 2026" },
      { name: "description", content: "Live scores, standings and results for the Machabeng College Inter-House Sports Day." },
      { name: "theme-color", content: "#0a1f3d" },
    ],
    links: [
      { rel: "icon", href: "/img/crest.png", type: "image/png" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;900&family=Figtree:wght@400;500;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: () => <Outlet />,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body style={{ margin: 0 }}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
