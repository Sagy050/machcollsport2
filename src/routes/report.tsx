import { createFileRoute } from "@tanstack/react-router";

// Serves the original report page as-is (see src/server/sportsday/html/report.html).
export const Route = createFileRoute("/report")({
  server: {
    handlers: {
      GET: async () => {
        const { page } = await import("@/server/sportsday/pages");
        return page("report");
      },
    },
  },
});
