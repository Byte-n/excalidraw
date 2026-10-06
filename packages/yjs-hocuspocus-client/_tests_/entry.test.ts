import { spawnSync } from "node:child_process";

import { expect, test } from "vitest";

test.each(["development", "production", "default"])(
  "%s package imports in Node without browser globals or storage",
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
        assert.equal(typeof navigator, 'undefined');
        assert.equal(typeof indexedDB, 'undefined');
        const runtime = await import('@excalidraw/yjs-hocuspocus-client');
        assert.equal(typeof runtime.createHocuspocusHeadlessSession, 'function');
        assert.equal(typeof runtime.createExcalidrawHocuspocusCollaboration, 'function');
        const platform = await import('@excalidraw/common');
        for (const flag of ['isDarwin','isWindows','isAndroid','isFirefox','isChrome','isSafari','isIOS']) { assert.equal(platform[flag], false); }
        const Y = await import('yjs');
        const session = runtime.createHocuspocusHeadlessSession({
          room: 'headless-entry', url: 'ws://127.0.0.1:1', token: () => 'token',
          validateScene: () => {},
        });
        assert.equal(session.document.constructor, Y.Doc);
        assert.equal(session.provider.document, session.document);
        assert.equal(session.provider.awareness.doc, session.document);
        await session.close();
        await assert.rejects(session.ready);
      `,
      ],
      { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  },
);
