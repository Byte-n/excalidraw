import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { dedupe: ["yjs"] },
  test: {
    environment: "node",
    include: ["packages/yjs-hocuspocus-client/_tests_/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    server: {
      deps: {
        inline: ["@hocuspocus/provider", "@hocuspocus/server", "y-protocols"],
      },
    },
  },
});
