import * as os from "node:os";
import * as path from "node:path";

import { defineConfig } from "vitest/config";

// Keep local test runs from consuming all CPU cores and memory:
// cap workers/concurrency at half of this machine's logical cores.
const halfCoreCount = Math.max(1, Math.floor(os.cpus().length / 2));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@excalidraw\/common$/,
        replacement: path.resolve(__dirname, "./packages/common/src/index.ts"),
      },
      {
        find: /^@excalidraw\/common\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/common/src/$1"),
      },
      {
        find: /^@excalidraw\/element$/,
        replacement: path.resolve(__dirname, "./packages/element/src/index.ts"),
      },
      {
        find: /^@excalidraw\/element\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/element/src/$1"),
      },
      {
        find: /^@excalidraw\/excalidraw$/,
        replacement: path.resolve(__dirname, "./packages/excalidraw/index.tsx"),
      },
      {
        find: /^@excalidraw\/excalidraw\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/excalidraw/$1"),
      },
      {
        find: /^@excalidraw\/math$/,
        replacement: path.resolve(__dirname, "./packages/math/src/index.ts"),
      },
      {
        find: /^@excalidraw\/math\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/math/src/$1"),
      },
      {
        find: /^@excalidraw\/utils$/,
        replacement: path.resolve(__dirname, "./packages/utils/src/index.ts"),
      },
      {
        find: /^@excalidraw\/utils\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/utils/src/$1"),
      },
      {
        find: /^@excalidraw\/fractional-indexing$/,
        replacement: path.resolve(
          __dirname,
          "./packages/fractional-indexing/src/index.ts",
        ),
      },
      {
        find: /^@excalidraw\/fractional-indexing\/(.*?)/,
        replacement: path.resolve(
          __dirname,
          "./packages/fractional-indexing/src/$1",
        ),
      },
      {
        find: /^@excalidraw\/laser-pointer$/,
        replacement: path.resolve(
          __dirname,
          "./packages/laser-pointer/src/index.ts",
        ),
      },
      {
        find: /^@excalidraw\/laser-pointer\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/laser-pointer/src/$1"),
      },
    ],
  },
  //@ts-ignore
  test: {
    // Keep local test runs from consuming all CPU cores and memory.
    maxWorkers: halfCoreCount,
    minWorkers: 1,
    fileParallelism: true,
    maxConcurrency: halfCoreCount,
    // Since hooks are running in stack in v2, which means all hooks run serially whereas
    // we need to run them in parallel
    sequence: {
      hooks: "parallel",
    },
    setupFiles: ["./setupTests.ts"],
    globals: true,
    environment: "jsdom",
    reporters: ["dot"],
    // These suites have their own Node projects below. Keep them out of the
    // browser project so they are not collected and run twice.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "packages/agent-tool/_tests_/**",
      "packages/yjs-hocuspocus-client/_tests_/**",
      "packages/yjs-hocuspocus-server/_tests_/**",
    ],
    workspace: [
      {
        extends: true,
        test: {
          name: "excalidraw-app",
        },
      },
      {
        resolve: { dedupe: ["yjs"] },
        test: {
          name: "agent-tool",
          maxConcurrency: halfCoreCount,
          globals: true,
          environment: "node",
          include: ["packages/agent-tool/_tests_/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
      {
        resolve: { dedupe: ["yjs"] },
        test: {
          name: "yjs-hocuspocus-client",
          maxConcurrency: halfCoreCount,
          environment: "node",
          include: ["packages/yjs-hocuspocus-client/_tests_/*.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**"],
          testTimeout: 10_000,
          hookTimeout: 10_000,
          server: {
            deps: {
              inline: ["@hocuspocus/provider", "@hocuspocus/server", "y-protocols"],
            },
          },
        },
      },
      {
        resolve: { dedupe: ["yjs"] },
        test: {
          name: "yjs-hocuspocus-server",
          maxConcurrency: halfCoreCount,
          environment: "node",
          include: ["packages/yjs-hocuspocus-server/_tests_/*.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**"],
          testTimeout: 10_000,
          hookTimeout: 10_000,
          server: {
            deps: {
              inline: ["@hocuspocus/provider", "@hocuspocus/server", "y-protocols"],
            },
          },
        },
      },
    ],
    // don't list skipped tests in the failure tree — keeps output readable
    hideSkippedTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json", "html", "lcovonly"],
      // Since v2, it ignores empty lines by default and we need to disable it as it affects the coverage
      // Additionally the thresholds also needs to be updated slightly as a result of this change
      ignoreEmptyLines: false,
      thresholds: {
        lines: 60,
        branches: 70,
        functions: 63,
        statements: 60,
      },
    },
  },
});
