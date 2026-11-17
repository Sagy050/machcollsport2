import { createFileRoute } from "@tanstack/react-router";

// Serves the original staff page as-is (see src/server/sportsday/html/staff.html).
export const Route = createFileRoute("/staff")({
  server: {
    handlers: {
      GET: async () => {
        const { page } = await import("@/server/sportsday/pages");
        return page("staff");
      },
    },
  },
});
