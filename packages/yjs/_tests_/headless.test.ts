import { spawnSync } from "node:child_process";

// Node v26 prints this ExperimentalWarning to stderr the first time
// `globalThis.localStorage` is touched and `--localstorage-file` was not passed.
// The child process below exists precisely to assert that no browser storage is
// available, so the warning is expected here; any other stderr line still fails
// the test.
const stripNodeStorageWarning = (stderr: string) =>
  stderr
    .split("\n")
    .filter(
      (line) =>
        !/^\(node:\d+\) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided\.$/.test(
          line,
        ) &&
        !/^\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)$/.test(
          line,
        ),
    )
    .join("\n")
    .trim();

test.each(["development", "production", "default"])(
  "%s public commands use factories, text and connection geometry without DOM",
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
          import * as Y from 'yjs';
          const {
            createSceneElement, createSceneTextElement, createSceneArrowElement,
            createSceneConnectionEndpoint, setCustomTextMetricsProvider,
            createSceneBinding, createExcalidrawSceneCommands,
          } = await import('@excalidraw/yjs');
          assert.equal(typeof window, 'undefined');
          assert.equal(typeof document, 'undefined');
          assert.equal(typeof indexedDB, 'undefined');
          setCustomTextMetricsProvider({getLineWidth: text => text.length * 10});
          const left = createSceneElement({type: 'rectangle', x: 0, y: 0, width: 100, height: 100});
          const right = createSceneElement({type: 'rectangle', x: 200, y: 0, width: 100, height: 100});
          const label = createSceneTextElement({text: 'Node 标签', x: 0, y: 120});
          const arrow = createSceneArrowElement({type: 'arrow', x: 100, y: 50, points: [[0, 0], [100, 0]]});
          const elbow = createSceneArrowElement({type: 'arrow', elbowed: true, x: 100, y: 50, points: [[0, 0], [100, 0]]});
          const elements = new Map([left, right, arrow, elbow].map(e => [e.id, e]));
          const start = createSceneConnectionEndpoint({arrow, target: left, end: 'start', elements});
          const end = createSceneConnectionEndpoint({arrow, target: right, end: 'end', elements});
          assert.equal(createSceneConnectionEndpoint({arrow: elbow, target: left, end: 'start', elements}).attachPoint.length, 2);
          const doc = new Y.Doc(); let updates = 0;
          doc.on('update', () => updates++);
          const binding = createSceneBinding({doc});
          binding.setGate({initialized: true, synced: true, canEdit: true});
          createExcalidrawSceneCommands({binding}).apply({mutations: [
            ...[left, right, label, arrow].map(element => ({type: 'add', element})),
            {type: 'connect', id: arrow.id, start, end},
          ]});
          assert.equal(updates, 1);
          assert.equal(binding.document.constructor, Y.Doc);
          assert.ok(label.width > 0);
          assert.equal(left.type, 'composite');
          doc.destroy();
        `,
      ],
      { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } },
    );
    expect(stripNodeStorageWarning(result.stderr)).toBe("");
    expect(result.status).toBe(0);
  },
);
