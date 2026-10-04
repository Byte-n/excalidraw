const puppeteer = require("puppeteer-core");

const chrome =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = process.env.TABLE_BENCH_URL || "http://127.0.0.1:5174/";
const sourceRoot = `/@fs${process.cwd()}/packages/excalidraw/data`;
const runs = Number(process.env.TABLE_BENCH_RUNS || 1);

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ];
};

const createFixture = async (page, size, shapeCount) => {
  await page.click('button[aria-label="Rectangle"]');
  await page.mouse.move(300, 500);
  await page.mouse.down();
  await page.mouse.move(330, 530);
  await page.mouse.up();
  await page.waitForFunction(() =>
    window.h.elements.some((element) => element.type === "composite_shape"),
  );
  const sourceShape = await page.evaluate(() =>
    window.h.elements.find((element) => element.type === "composite_shape"),
  );
  await page.click('button[title="更多工具"]');
  const [tableButton] = await page.$x('//button[contains(., "Table")]');
  await tableButton.click();
  await page.mouse.move(250, 200);
  await page.mouse.down();
  await page.mouse.move(730, 368);
  await page.mouse.up();

  return page.evaluate(
    ({ size, shapeCount, sourceShape }) => {
      const app = window.h.app;
      const sourceTable = window.h.elements.find(
        (element) => element.type === "table",
      );
      if (!sourceTable || !sourceShape) {
        throw new Error(
          `Fixture tools did not create both elements: ${window.h.elements
            .map((element) => element.type)
            .join(", ")}`,
        );
      }
      const rows = Array.from({ length: size }, (_, i) => ({
        id: `bench-row-${i}`,
        height: 56,
      }));
      const columns = Array.from({ length: size }, (_, i) => ({
        id: `bench-column-${i}`,
        width: 160,
      }));
      const cells = rows.flatMap((row, rowIndex) =>
        columns.map((column, columnIndex) => ({
          id: `bench-cell-${rowIndex}-${columnIndex}`,
          rowId: row.id,
          columnId: column.id,
          style: {},
        })),
      );
      for (let index = 0; index < 10 && size >= 24; index++) {
        const row = 4 + index * 2;
        const column = 4 + index * 2;
        const anchor = cells[row * size + column];
        anchor.rowSpan = 2;
        anchor.columnSpan = 2;
        for (const [r, c] of [
          [row, column + 1],
          [row + 1, column],
          [row + 1, column + 1],
        ]) {
          cells[r * size + c].mergedInto = anchor.id;
        }
      }
      const table = {
        ...sourceTable,
        id: "bench-table",
        table: { schemaVersion: 1, rows, columns, cells },
        width: size * 160,
        height: size * 56,
        version: sourceTable.version + 1,
      };
      const shapes = Array.from({ length: shapeCount }, (_, index) => {
        const row = Math.floor(index / size) % Math.min(size, 4);
        const column = index % size;
        return {
          ...sourceShape,
          id: `bench-shape-${index}`,
          x: table.x + column * 160 + 4,
          y: table.y + row * 56 + 4,
          width: 20,
          height: 20,
          versionNonce: index + 1,
          containerRef: {
            kind: "tableCell",
            elementId: table.id,
            cellId: cells[row * size + column].id,
            role: "content",
          },
        };
      });
      const nested = [];
      let parent = table;
      let parentCellId = cells[(size - 1) * size + size - 1].id;
      for (let depth = 0; depth < 3; depth++) {
        const child = {
          ...sourceTable,
          id: `bench-nested-${depth}`,
          x: parent.x + (depth ? 8 : (size - 1) * 160 + 8),
          y: parent.y + (depth ? 8 : (size - 1) * 56 + 8),
          containerRef: {
            kind: "tableCell",
            elementId: parent.id,
            cellId: parentCellId,
            role: "content",
          },
          versionNonce: depth + 10000,
        };
        nested.push(child);
        parent = child;
        parentCellId = child.table.cells[0].id;
      }
      const createStart = performance.now();
      app.api.updateScene({ elements: [table, ...shapes, ...nested] });
      return {
        tableId: table.id,
        cellCount: cells.length,
        shapeCount: shapes.length,
        nestedDepth: nested.length,
        mergeCount: size >= 24 ? 10 : 0,
        createMs: performance.now() - createStart,
      };
    },
    { size, shapeCount, sourceShape },
  );
};

const benchmark = async (browser, profile) => {
  const context = await browser.createIncognitoBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector(".excalidraw__canvas.interactive");
  const fixture = await createFixture(page, profile.size, profile.shapeCount);
  await page.setViewport(profile.viewport);
  if (profile.name !== "desktop") {
    await page.evaluate(() => window.h.app.setState({ scrollX: -130 }));
    await page.waitForFunction(() => window.h.state.scrollX === -130);
  }
  await page.waitForFunction(() =>
    window.h.elements.some((element) => element.id === "bench-table"),
  );
  await page.waitForTimeout(1000);

  const measurements = await page.evaluate(async (dataModuleRoot) => {
    const app = window.h.app;
    const { serializeAsJSON } = await import(`${dataModuleRoot}/json.ts`);
    const { loadFromBlob } = await import(`${dataModuleRoot}/blob.ts`);
    const { exportToSvg } = await import(
      `${dataModuleRoot}/../scene/export.ts`
    );
    const memory = () => performance.memory?.usedJSHeapSize ?? null;
    const heapStart = memory();
    const hitTimes = [];
    for (let index = 0; index < 120; index++) {
      const x = 260 + (index % 5) * 160;
      const y = 210 + (index % 4) * 56;
      const start = performance.now();
      for (let repeat = 0; repeat < 20; repeat++) {
        app.getTableCellDropTargetAtSceneCoords(x, y);
      }
      hitTimes.push((performance.now() - start) / 20);
    }
    const heapAfterHit = memory();
    const original = app.api.getSceneElementsIncludingDeleted();
    const saveStart = performance.now();
    const serialized = serializeAsJSON(
      original,
      app.state,
      app.api.getFiles(),
      "local",
    );
    const saveMs = performance.now() - saveStart;
    const openStart = performance.now();
    const file = new app.ownerWindow.File(
      [serialized],
      "benchmark.excalidraw",
      {
        type: "application/vnd.excalidraw+json",
      },
    );
    const reopened = await loadFromBlob(file, null, null);
    app.api.updateScene({ elements: reopened.elements });
    const openMs = performance.now() - openStart;
    const heapAfterOpen = memory();
    const reopenedTable = app.api
      .getSceneElementsIncludingDeleted()
      .find((element) => element.id === "bench-table");
    const exportStart = performance.now();
    const svg = await exportToSvg(
      app.api.getSceneElements(),
      {
        exportBackground: false,
        exportPadding: 0,
        viewBackgroundColor: "#ffffff",
      },
      app.api.getFiles(),
      { skipInliningFonts: true },
    );
    const exportMs = performance.now() - exportStart;
    return {
      hitTimes,
      saveMs,
      openMs,
      heapStart,
      heapAfterHit,
      heapAfterOpen,
      reopenedCount: app.api.getSceneElementsIncludingDeleted().length,
      reopenedRows: reopenedTable?.table.rows.length,
      reopenedColumns: reopenedTable?.table.columns.length,
      reopenedMerges: reopenedTable?.table.cells.filter(
        (cell) => cell.rowSpan === 2 && cell.columnSpan === 2,
      ).length,
      serializedBytes: new TextEncoder().encode(serialized).length,
      exportMs,
      svgNodes: svg.querySelectorAll("path, rect, line").length,
    };
  }, sourceRoot);

  await page.waitForTimeout(500);

  await page.evaluate(() => {
    window.__benchFrames = [];
    window.__benchFramesActive = true;
    const tick = (time) => {
      if (!window.__benchFramesActive) {
        return;
      }
      window.__benchFrames.push(time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.click('button[aria-label="选择"]');
  const dragX = profile.name === "desktop" ? 350 : 300;
  const dragY = profile.name === "desktop" ? 340 : 335;
  await page.evaluate(() =>
    window.h.app.setState({
      selectedElementIds: { "bench-table": true },
      tableCellSelection: null,
      tableRowColSelection: null,
    }),
  );
  await page.waitForFunction(
    () => window.h.state.selectedElementIds["bench-table"],
  );
  if (process.env.TABLE_BENCH_SCREENSHOT) {
    await page.screenshot({
      path: `${process.env.TABLE_BENCH_SCREENSHOT}-${profile.name}.png`,
    });
  }
  const tableXBeforeDrag = await page.evaluate(
    () => window.h.elements.find((element) => element.id === "bench-table").x,
  );
  const dragState = await page.evaluate(() => ({
    selectedElementIds: window.h.state.selectedElementIds,
    scrollX: window.h.state.scrollX,
    scrollY: window.h.state.scrollY,
    zoom: window.h.state.zoom.value,
    offsetLeft: window.h.state.offsetLeft,
    offsetTop: window.h.state.offsetTop,
  }));
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  for (let index = 0; index < 30; index++) {
    await page.mouse.move(dragX + index * 3, dragY + index * 2);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const tableXAfterDrag = await page.evaluate(
    () => window.h.elements.find((element) => element.id === "bench-table").x,
  );
  const frameTimes = await page.evaluate(() => {
    window.__benchFramesActive = false;
    return window.__benchFrames;
  });
  const frameIntervals = frameTimes
    .slice(1)
    .map((time, index) => time - frameTimes[index]);
  const scaleBefore = await page.evaluate(() => {
    const table = window.h.elements.find(
      (element) => element.id === "bench-table",
    );
    return { x: table.x, y: table.y, width: table.width, height: table.height };
  });
  const handleX = profile.viewport.width - 160;
  const handleY = profile.viewport.height - 160;
  await page.evaluate(
    ({ scrollX, scrollY }) => window.h.app.setState({ scrollX, scrollY }),
    {
      scrollX: handleX - scaleBefore.x - scaleBefore.width,
      scrollY: handleY - scaleBefore.y - scaleBefore.height,
    },
  );
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.__benchFrames = [];
    window.__benchFramesActive = true;
    const tick = (time) => {
      if (!window.__benchFramesActive) {
        return;
      }
      window.__benchFrames.push(time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  for (let index = 0; index < 20; index++) {
    await page.mouse.move(handleX + index * 4, handleY + index * 4);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const scaleFrameTimes = await page.evaluate(() => {
    window.__benchFramesActive = false;
    return window.__benchFrames;
  });
  const scaleAfter = await page.evaluate(
    () =>
      window.h.elements.find((element) => element.id === "bench-table").width,
  );
  const scaleFrameIntervals = scaleFrameTimes
    .slice(1)
    .map((time, index) => time - scaleFrameTimes[index]);
  let touchAccessibility = null;
  if (profile.name !== "desktop") {
    await page.evaluate(() =>
      window.h.app.setState({
        scrollX: -130,
        scrollY: 0,
        selectedElementIds: { "bench-table": true },
      }),
    );
    await page.waitForFunction(() => window.h.state.scrollY === 0);
    const client = await page.target().createCDPSession();
    await client.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 2,
    });
    await page.touchscreen.tap(300, 343);
    touchAccessibility = await page.evaluate(() => {
      const grid = document.querySelector(".table-accessibility-grid");
      const button = document.querySelector(
        '[data-testid="table-cell-multi-select"]',
      );
      const buttonBounds = button?.getBoundingClientRect();
      return {
        touchScreen: window.h.app.editorInterface.isTouchScreen,
        selectedCellId: window.h.state.tableCellSelection?.focusId ?? null,
        selectedElementIds: window.h.state.selectedElementIds,
        rowColSelection: window.h.state.tableRowColSelection,
        rowCount: grid?.getAttribute("aria-rowcount") ?? null,
        columnCount: grid?.getAttribute("aria-colcount") ?? null,
        gridcellCount: grid?.querySelectorAll('[role="gridcell"]').length ?? 0,
        buttonWidth: buttonBounds?.width ?? 0,
        buttonHeight: buttonBounds?.height ?? 0,
      };
    });
    const firstCellId = touchAccessibility.selectedCellId;
    await page.focus(".table-accessibility-grid");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    touchAccessibility.keyboardFocus = await page.evaluate(() => ({
      activeElement: document.activeElement?.className ?? null,
      focusId: window.h.state.tableCellSelection?.focusId ?? null,
    }));
    touchAccessibility.keyboardMoved =
      touchAccessibility.keyboardFocus.focusId !== firstCellId;
    await page.keyboard.press("Enter");
    touchAccessibility.enterOpenedText = await page.evaluate(
      () => !!window.h.state.editingTextElement,
    );
    await client.detach();
  }
  const result = {
    profile: profile.name,
    browser: await browser.version(),
    viewport: profile.viewport,
    fixture,
    dragState,
    dragDistance: tableXAfterDrag - tableXBeforeDrag,
    hitP95Ms: percentile(measurements.hitTimes, 0.95),
    frameIntervalP95Ms: percentile(frameIntervals, 0.95),
    frameFpsP95: 1000 / percentile(frameIntervals, 0.95),
    scaleWidthDelta: scaleAfter - scaleBefore.width,
    scaleFrameIntervalP95Ms: percentile(scaleFrameIntervals, 0.95),
    scaleFpsP95: 1000 / percentile(scaleFrameIntervals, 0.95),
    touchAccessibility,
    saveMs: measurements.saveMs,
    openMs: measurements.openMs,
    serializedBytes: measurements.serializedBytes,
    exportMs: measurements.exportMs,
    svgNodes: measurements.svgNodes,
    reopenedCount: measurements.reopenedCount,
    reopenedRows: measurements.reopenedRows,
    reopenedColumns: measurements.reopenedColumns,
    reopenedMerges: measurements.reopenedMerges,
    peakHeapBytes: Math.max(
      measurements.heapStart || 0,
      measurements.heapAfterHit || 0,
      measurements.heapAfterOpen || 0,
    ),
  };
  if (
    result.dragDistance <= 0 ||
    result.scaleWidthDelta <= 0 ||
    result.reopenedCount !== fixture.shapeCount + fixture.nestedDepth + 1 ||
    result.reopenedRows !== profile.size ||
    result.reopenedColumns !== profile.size ||
    result.reopenedMerges !== fixture.mergeCount ||
    result.svgNodes === 0 ||
    result.hitP95Ms > 50 ||
    result.frameFpsP95 < 30 ||
    result.scaleFpsP95 < 30 ||
    (touchAccessibility &&
      (!touchAccessibility.touchScreen ||
        !touchAccessibility.selectedCellId ||
        touchAccessibility.rowCount !== String(profile.size) ||
        touchAccessibility.columnCount !== String(profile.size) ||
        touchAccessibility.gridcellCount !== 1 ||
        touchAccessibility.buttonWidth < 44 ||
        touchAccessibility.buttonHeight < 44 ||
        !touchAccessibility.keyboardMoved ||
        !touchAccessibility.enterOpenedText))
  ) {
    throw new Error(`Table benchmark failed: ${JSON.stringify(result)}`);
  }
  await context.close();
  return result;
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--enable-precise-memory-info"],
  });
  try {
    const profiles = [
      {
        name: "desktop",
        size: 100,
        shapeCount: 1000,
        viewport: { width: 1440, height: 900 },
      },
      {
        name: "mobile-emulation",
        size: 30,
        shapeCount: 200,
        viewport: { width: 390, height: 844 },
      },
    ];
    const results = new Map(profiles.map((profile) => [profile.name, []]));
    for (let run = 0; run < runs; run++) {
      for (const profile of profiles) {
        const result = await benchmark(browser, profile);
        results.get(profile.name).push(result);
        if (runs === 1) {
          console.log(JSON.stringify(result));
        }
      }
    }
    if (runs > 1) {
      for (const profile of profiles) {
        const samples = results.get(profile.name);
        const values = (key) => samples.map((sample) => sample[key]);
        console.log(
          JSON.stringify({
            profile: profile.name,
            browser: samples[0].browser,
            viewport: profile.viewport,
            runs,
            fixture: samples[0].fixture,
            createP95Ms: percentile(
              samples.map((sample) => sample.fixture.createMs),
              0.95,
            ),
            hitP95Ms: percentile(values("hitP95Ms"), 0.95),
            dragFrameIntervalP95Ms: percentile(
              values("frameIntervalP95Ms"),
              0.95,
            ),
            scaleFrameIntervalP95Ms: percentile(
              values("scaleFrameIntervalP95Ms"),
              0.95,
            ),
            saveP95Ms: percentile(values("saveMs"), 0.95),
            openP95Ms: percentile(values("openMs"), 0.95),
            exportP95Ms: percentile(values("exportMs"), 0.95),
            peakHeapBytes: Math.max(...values("peakHeapBytes")),
            reopenedCount: samples[0].reopenedCount,
            reopenedMerges: samples[0].reopenedMerges,
            svgNodes: samples[0].svgNodes,
            touchAccessibility: samples[0].touchAccessibility,
          }),
        );
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
