import { createFileRoute } from "@tanstack/react-router";

// Every /api/* request goes to the Sports Day API (server only; checks sign-in and roles itself).
const handle = async ({ request }: { request: Request }) => {
  const { handleApi } = await import("@/server/sportsday/api");
  return handleApi(request);
};

export const Route = createFileRoute("/api/$")({
  server: { handlers: { GET: handle, POST: handle, PATCH: handle, DELETE: handle } },
});
