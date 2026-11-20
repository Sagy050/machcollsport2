import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/ads")({
  server: {
    handlers: {
      GET: async () => {
        const { page } = await import("@/server/sportsday/pages");
        return page("ads");
      },
    },
  },
});
