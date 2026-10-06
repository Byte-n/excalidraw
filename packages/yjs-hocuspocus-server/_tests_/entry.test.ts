import { spawnSync } from "node:child_process";

import { expect, test } from "vitest";

test.each(["development", "production", "default"])(
  "%s server entry imports without browser globals and leaves Server ownership to the host",
  (condition) => {
    const result = spawnSync(
      process.execPath,
      [
        ...(condition === "default" ? [] : [`--conditions=${condition}`]),
        "--input-type=module",
        "-e",
        `
        import assert from 'node:assert/strict';
        delete globalThis.navigator;
        assert.equal(typeof window, 'undefined');
        assert.equal(typeof document, 'undefined');
        assert.equal(typeof navigator, 'undefined');
        const runtime = await import('@excalidraw/yjs-hocuspocus-server');
        assert.equal(typeof runtime.createCanvasHocuspocusHooks, 'function');
        assert.equal(typeof runtime.CanvasHookError, 'function');
        assert.equal(runtime.Server, undefined);
      `,
      ],
      { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  },
);
