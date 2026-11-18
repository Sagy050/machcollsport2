import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: async () => {
        const { version } = await import("@/server/sportsday/store");
        return Response.json({ ok: true, v: await version() }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
