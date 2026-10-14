import { reseed } from "@excalidraw/common";

import {
  TABLE_PRESET_TITLE_FILL,
  getTablePresetLabelCells,
} from "@excalidraw/element";

import type {
  ExcalidrawTableElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { t } from "../i18n";

import { Keyboard, Pointer, UI } from "./helpers/ui";
import { API } from "./helpers/api";
import { act, fireEvent, render, screen, waitFor } from "./test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

const live = () => h.elements.filter((element) => !element.isDeleted);

const tables = () =>
  live().filter(
    (element): element is ExcalidrawTableElement => element.type === "table",
  );

const cellLabels = () =>
  live().filter(
    (element): element is ExcalidrawTextElement =>
      element.type === "text" &&
      element.containerRef?.kind === "tableCell" &&
      element.containerRef.role === "backgroundText",
  );

/** 打开表格预设弹层（触发按钮沿用 `toolbar-<工具>` 的既有约定） */
const openPresets = () => {
  fireEvent.click(screen.getByTestId("toolbar-table"));
};

const presetOptions = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      ".tool-popover-content [data-testid^='toolbar-']",
    ),
  );

const choosePreset = async (id: string) => {
  // 选中一条预设不会收起弹层（同便签样式），画布上按一下才收
  if (!document.querySelector(`[data-testid="toolbar-${id}"]`)) {
    openPresets();
  }
  fireEvent.click(await waitFor(() => screen.getByTestId(`toolbar-${id}`)));
};

/**
 * (行, 列) 交点上的**可见**格 id：合并区的被覆盖格回锚点——与装配时用的
 * `getTableCellIdAt` 同一套解析，标签因此落在双击会打开的那一格里。
 */
const cellIdAt = (
  table: ExcalidrawTableElement,
  row: number,
  column: number,
) => {
  const cell = table.table.cells.find(
    (candidate) =>
      candidate.rowId === table.table.rows[row].id &&
      candidate.columnId === table.table.columns[column].id,
  );
  return cell?.mergedInto ?? cell?.id;
};

describe("表格预设弹层", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw handleKeyboardGlobally />);
  });

  it("列出普通表格与两条泳道，触发按钮回显当前预设", () => {
    expect(screen.getByTestId("toolbar-table")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    openPresets();

    expect(presetOptions().map((option) => option.dataset.testid)).toEqual([
      "toolbar-plain",
      "toolbar-swimlane-horizontal",
      "toolbar-swimlane-vertical",
    ]);
  });

  it("选一条泳道预设即激活表格工具并回显它", async () => {
    await choosePreset("swimlane-vertical");

    expect(h.state.currentTablePreset).toBe("swimlane-vertical");
    expect(h.state.activeTool.type).toBe("table");
    expect(screen.getByTestId("toolbar-table")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // 弹层里高亮的是选中的那条（选中后弹层仍在，不必再点开）
    expect(screen.getByTestId("toolbar-swimlane-vertical")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("toolbar-plain")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("泳道预设的落地", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally />);
  });

  const SWIMLANES = [
    {
      id: "swimlane-horizontal",
      width: 782,
      height: 688,
      rows: [344, 344],
      columns: [64, 64, 654],
      title: t("toolBar.swimlaneHorizontal"),
    },
    {
      id: "swimlane-vertical",
      width: 688,
      height: 782,
      rows: [64, 64, 654],
      columns: [344, 344],
      title: t("toolBar.swimlaneVertical"),
    },
  ] as const;

  it.each(SWIMLANES)(
    "$id 单击落地：整张表落在按下点，尺寸是样本的转置关系",
    async ({ id, width, height, rows, columns }) => {
      await choosePreset(id);
      mouse.clickAt(300, 240);

      expect(tables()).toHaveLength(1);
      const table = tables()[0];
      expect(table).toMatchObject({ x: 300, y: 240, width, height });
      expect(table.table.rows.map((row) => row.height)).toEqual([...rows]);
      expect(table.table.columns.map((column) => column.width)).toEqual([
        ...columns,
      ]);
      // 首行表头带关掉：泳道预设的表头带是自己画的那条
      expect(table.table.style).toEqual({ header: false });
      // 新建的表被选中，工具回到选择工具（与普通表格一致）
      expect(h.state.selectedElementIds[table.id]).toBe(true);
      expect(h.state.activeTool.type).toBe("selection");
    },
  );

  it("自带标签文字：标题带写在合并区锚点上，每条泳道一个名字", async () => {
    await choosePreset("swimlane-horizontal");
    mouse.clickAt(300, 240);

    const table = tables()[0];
    const labels = cellLabels();

    expect(labels.map((label) => label.originalText)).toEqual([
      t("toolBar.swimlaneHorizontal"),
      t("toolBar.swimlane"),
      t("toolBar.swimlane"),
    ]);

    // 标签挂在 `getTablePresetLabelCells` 给出的格位上，且是**可见**的格
    const cellIds = getTablePresetLabelCells("swimlane-horizontal").map(
      (cell) => cellIdAt(table, cell.rowIndex, cell.columnIndex),
    );
    expect(
      labels.map(
        (label) =>
          label.containerRef?.kind === "tableCell" && label.containerRef.cellId,
      ),
    ).toEqual(cellIds);
    // 标题带的被覆盖格回锚点：标签和双击编辑挂在同一格
    expect(cellIdAt(table, 1, 0)).toBe(cellIdAt(table, 0, 0));

    // 18px、水平垂直居中：与样本的单元格文字一致
    expect(labels.map((label) => label.fontSize)).toEqual([18, 18, 18]);
    expect(labels.map((label) => label.textAlign)).toEqual([
      "center",
      "center",
      "center",
    ]);
    expect(labels.map((label) => label.verticalAlign)).toEqual([
      "middle",
      "middle",
      "middle",
    ]);
  });

  it("标题带的底纹是主题令牌，画布与弹层缩略图同色", async () => {
    await choosePreset("swimlane-horizontal");
    mouse.clickAt(300, 240);

    const table = tables()[0];
    const titleCell = table.table.cells.find(
      (cell) => cell.rowId === table.table.rows[0].id,
    );
    expect(titleCell).toMatchObject({
      rowSpan: 2,
      style: { backgroundColor: TABLE_PRESET_TITLE_FILL },
    });
  });

  it("表格与标签是一次可撤销的操作", async () => {
    await choosePreset("swimlane-horizontal");
    mouse.clickAt(300, 240);
    expect(live()).toHaveLength(4);
    expect(API.getUndoStack()).toHaveLength(1);

    Keyboard.undo();
    expect(live()).toHaveLength(0);

    Keyboard.redo();
    expect(live()).toHaveLength(4);
  });

  it("悬停预览画的是整张表（表 + 标签），且不推进 id 序列", async () => {
    await choosePreset("swimlane-horizontal");
    mouse.moveTo(400, 300);

    const preview = h.app.createPreview.elements!;
    expect(preview.map((element) => element.type)).toEqual([
      "table",
      "text",
      "text",
      "text",
    ]);
    // 鼠标点即表格左上角（与落地同一锚点）
    expect(preview[0]).toMatchObject({
      x: 400,
      y: 300,
      width: 782,
      height: 688,
    });
    expect(h.elements).toHaveLength(0);

    // 预览不入场景，也不该消耗共享的 id 序列
    act(() => h.app.createPreview.clear());
    UI.clickTool("freedraw");
    mouse.downAt(40, 40);
    mouse.moveTo(80, 80);
    mouse.upAt();

    expect(live()).toHaveLength(1);
    expect(live()[0].id).toBe("id0");
  });

  it("换回普通表格：单击仍是 3×3 的默认尺寸", async () => {
    await choosePreset("swimlane-horizontal");
    await choosePreset("plain");
    mouse.clickAt(300, 240);

    expect(tables()).toHaveLength(1);
    expect(tables()[0]).toMatchObject({
      x: 300,
      y: 240,
      width: 480,
      height: 168,
    });
    expect(cellLabels()).toHaveLength(0);
  });

  it("普通表格的悬停预览也守同一条规矩：不推进共享的 id 序列", async () => {
    // 表格的网格自己也取 id（行列与单元格），只固定元素身份不够——两者都从
    // 预览身份派生，预览才不会「隔空」改变后续真实元素的身份
    UI.clickTool("table");
    mouse.moveTo(400, 300);
    expect(h.app.createPreview.elements).toHaveLength(1);

    act(() => h.app.createPreview.clear());
    UI.clickTool("freedraw");
    mouse.downAt(40, 40);
    mouse.moveTo(80, 80);
    mouse.upAt();

    expect(live()).toHaveLength(1);
    expect(live()[0].id).toBe("id0");
  });
});
