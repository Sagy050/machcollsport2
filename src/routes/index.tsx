import { createFileRoute } from "@tanstack/react-router";

// Serves the original index page as-is (see src/server/sportsday/html/index.html).
export const Route = createFileRoute("/")({
  server: {
    handlers: {
      GET: async () => {
        const { page } = await import("@/server/sportsday/pages");
        return page("index");
      },
    },
  },
});
