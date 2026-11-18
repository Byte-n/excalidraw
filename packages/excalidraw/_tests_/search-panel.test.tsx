import React from "react";

import { vi } from "vitest";

import {
  CANVAS_SEARCH_TAB,
  CLASSES,
  DEFAULT_SIDEBAR,
  KEYS,
} from "@excalidraw/common";

import type { FractionalIndex } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { t } from "../i18n";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { updateTextEditor } from "./queries/dom";
import { act, render, waitFor } from "./test-utils";

import type { SearchPanelItem } from "../types";

const { h } = window;

const getContainer = () => h.app.excalidrawContainerValue.container!;

const querySearchInput = async () => {
  const selector = `.${CLASSES.SEARCH_MENU_INPUT_WRAPPER} input`;
  await waitFor(() => {
    expect(getContainer().querySelector(selector)).not.toBeNull();
  });
  return getContainer().querySelector<HTMLInputElement>(selector)!;
};

const queryFilterInput = () =>
  getContainer().querySelector<HTMLInputElement>(
    ".layer-ui__search-header input",
  )!;

const queryResultRows = () =>
  Array.from(
    getContainer().querySelectorAll<HTMLElement>(".layer-ui__result-item"),
  );

const queryPanel = () => getContainer().querySelectorAll(".layer-ui__search");

const hasTitle = () =>
  !!getContainer().querySelector(".layer-ui__search-title");

const openPanel = (options: Parameters<typeof h.app.openSearchPanel>[0]) => {
  let opened = false;
  act(() => {
    opened = h.app.openSearchPanel(options);
  });
  return opened;
};

const closePanel = () => {
  act(() => {
    h.app.closeSearchPanel();
  });
};

describe("search panel", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    API.setAppState({ openSidebar: null });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("opens the search tab in search mode and honors all-term matching", async () => {
    const both = API.createElement({
      type: "text",
      text: "alpha beta",
      x: 0,
      y: 0,
    });
    const apart = API.createElement({
      type: "text",
      text: "alpha x beta",
      x: 0,
      y: 100,
    });
    const single = API.createElement({
      type: "text",
      text: "alpha only",
      x: 0,
      y: 200,
    });
    API.setElements([both, apart, single]);

    expect(
      openPanel({
        mode: "search",
        query: ["alpha", "beta"],
        match: "all",
      }),
    ).toBe(true);
    expect(h.app.state.openSidebar).toEqual({
      name: DEFAULT_SIDEBAR.name,
      tab: CANVAS_SEARCH_TAB,
    });

    const input = await querySearchInput();
    expect(input.value).toBe("alpha beta");

    await waitFor(() => {
      expect(queryResultRows()).toHaveLength(4);
      expect(h.app.state.searchMatches?.matches).toHaveLength(4);
    });
    // 只保留同时命中全部词的元素
    expect(
      new Set(h.app.state.searchMatches?.matches.map((match) => match.id)),
    ).toEqual(new Set([both.id, apart.id]));

    // 用户编辑后退化为单字符串字面查询
    updateTextEditor(input, "alpha x beta");

    await waitFor(() => {
      expect(queryResultRows()).toHaveLength(1);
    });
    expect(queryResultRows()[0].textContent).toContain("alpha x beta");
  });

  it("renders locate items with groups and filters them", async () => {
    const first = API.createElement({
      type: "text",
      text: "first",
      x: 0,
      y: 0,
    });
    const second = API.createElement({
      type: "text",
      text: "second",
      x: 0,
      y: 100,
    });
    const third = API.createElement({
      type: "text",
      text: "third",
      x: 0,
      y: 200,
    });
    API.setElements([first, second, third]);

    const items: SearchPanelItem[] = [
      {
        elementId: first.id,
        label: "Alpha note",
        preview: "first preview",
        group: "Notes",
      },
      {
        elementId: second.id,
        label: "Beta table",
        detail: "table detail",
        group: "Tables",
      },
      { elementId: third.id, label: "Gamma locked", group: "Notes" },
      // 不存在与重复条目都应被剔除
      { elementId: "missing", label: "Missing", group: "Notes" },
      { elementId: first.id, label: "Alpha duplicate", group: "Notes" },
    ];

    expect(openPanel({ mode: "locate", title: "Locations", items })).toBe(true);
    expect(hasTitle()).toBe(true);

    expect(queryResultRows()).toHaveLength(3);
    expect(
      Array.from(
        getContainer().querySelectorAll(".layer-ui__search-result-title"),
      ).map((title) => title.textContent),
    ).toEqual(["Notes", "Tables"]);
    expect(h.app.state.searchMatches).toBeNull();

    updateTextEditor(queryFilterInput(), "beta");

    await waitFor(() => {
      expect(queryResultRows()).toHaveLength(1);
    });
    expect(queryResultRows()[0].textContent).toContain("Beta table");
    expect(queryResultRows()[0].textContent).toContain("table detail");

    act(() => {
      queryResultRows()[0].click();
    });
    expect(h.state.selectedElementIds[second.id]).toBe(true);

    updateTextEditor(queryFilterInput(), "nothing matches");

    await waitFor(() => {
      expect(queryResultRows()).toHaveLength(0);
    });
    expect(getContainer().textContent).toContain(t("search.noMatch"));
  });

  it("supports locate initial focus via focusFirst and activeElementId", async () => {
    const first = API.createElement({ type: "text", text: "first" });
    const second = API.createElement({ type: "text", text: "second" });
    API.setElements([first, second]);

    const items: SearchPanelItem[] = [
      { elementId: first.id, label: "First" },
      { elementId: second.id, label: "Second" },
    ];

    openPanel({ mode: "locate", items, focusFirst: true });
    expect(queryResultRows()[0].classList.contains("active")).toBe(true);
    expect(queryResultRows()[1].classList.contains("active")).toBe(false);

    openPanel({ mode: "locate", items, activeElementId: second.id });
    await waitFor(() => {
      expect(queryResultRows()[1].classList.contains("active")).toBe(true);
    });

    openPanel({ mode: "locate", items, focusFirst: false });
    await waitFor(() => {
      expect(
        queryResultRows().some((row) => row.classList.contains("active")),
      ).toBe(false);
    });
  });

  it("returns false and keeps the sidebar closed when no item is displayable", async () => {
    const deleted = API.createElement({
      type: "text",
      text: "deleted",
      isDeleted: true,
    });
    const root = API.createElement({
      type: "mindmap-node",
      x: 0,
      y: 0,
      mindmap: {
        graphId: "graph-1",
        parentId: null,
        order: null,
        collapsed: true,
        shape: { id: "rectangle", schemaVersion: 1 },
      },
      texts: API.mindmapBody({ role: "root" }, "root label"),
    });
    const hidden = API.createElement({
      type: "mindmap-node",
      x: 0,
      y: 100,
      mindmap: {
        graphId: "graph-1",
        parentId: root.id,
        order: "a1" as FractionalIndex,
        collapsed: false,
        shape: { id: "rectangle", schemaVersion: 1 },
      },
      texts: API.mindmapBody({ role: "node" }, "hidden label"),
    });
    API.setElements([deleted, root, hidden]);

    expect(openPanel({ mode: "locate", items: [] })).toBe(false);
    expect(
      openPanel({
        mode: "locate",
        items: [
          { elementId: deleted.id, label: "deleted" },
          { elementId: "missing", label: "missing" },
          { elementId: hidden.id, label: "hidden" },
        ],
      }),
    ).toBe(false);

    expect(h.app.state.openSidebar).toBeNull();
    expect(queryPanel()).toHaveLength(0);
  });

  it("keeps a single panel instance when content is replaced", async () => {
    const element = API.createElement({ type: "text", text: "alpha" });
    API.setElements([element]);

    openPanel({
      mode: "locate",
      items: [{ elementId: element.id, label: "Alpha item" }],
    });
    expect(queryPanel()).toHaveLength(1);
    expect(queryResultRows()).toHaveLength(1);

    openPanel({ mode: "search", query: "alpha" });
    await waitFor(() => {
      expect(queryResultRows()).toHaveLength(1);
    });
    expect(queryPanel()).toHaveLength(1);
    expect(getContainer().textContent).not.toContain("Alpha item");

    openPanel({ mode: "search", query: "missing" });
    await waitFor(() => {
      expect(queryResultRows()).toHaveLength(0);
    });
    expect(queryPanel()).toHaveLength(1);
  });

  it("cancels an in-flight search when a host locate panel opens", async () => {
    const element = API.createElement({ type: "text", text: "needle" });
    API.setElements([element]);

    act(() => {
      Keyboard.withModifierKeys({ ctrl: true }, () => {
        Keyboard.keyPress(KEYS.F);
      });
    });
    const input = await querySearchInput();
    updateTextEditor(input, "needle");

    // 不等待 debounce，立即由宿主切到 locate
    expect(
      openPanel({
        mode: "locate",
        items: [{ elementId: element.id, label: "Needle item" }],
      }),
    ).toBe(true);
    expect(queryResultRows()).toHaveLength(1);

    // 等待超过 debounce 时长，确认待触发的搜索结果没有写入
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(h.app.state.searchMatches).toBeNull();
    expect(queryResultRows()).toHaveLength(1);
    expect(queryResultRows()[0].textContent).toContain("Needle item");
  });

  it("drops a stale debounced search when the host replaces the query", async () => {
    const stale = API.createElement({
      type: "text",
      text: "stale",
      x: 0,
      y: 0,
    });
    const fresh = API.createElement({
      type: "text",
      text: "fresh",
      x: 0,
      y: 100,
    });
    API.setElements([stale, fresh]);

    act(() => {
      Keyboard.withModifierKeys({ ctrl: true }, () => {
        Keyboard.keyPress(KEYS.F);
      });
    });
    const input = await querySearchInput();
    updateTextEditor(input, "stale");

    // 不等待 debounce，立即由宿主替换为新查询
    expect(openPanel({ mode: "search", query: "fresh" })).toBe(true);

    // 超过旧查询与新查询两次 debounce 的间隔，确认旧结果从未写入
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(
      queryResultRows().some((row) => row.textContent?.includes("stale")),
    ).toBe(false);
    expect(
      h.app.state.searchMatches?.matches.some(
        (match) => match.id === stale.id,
      ) ?? false,
    ).toBe(false);

    await waitFor(() => {
      expect(queryResultRows()).toHaveLength(1);
    });
    expect(queryResultRows()[0].textContent).toContain("fresh");
    expect(h.app.state.searchMatches?.matches).toHaveLength(1);
    expect(h.app.state.searchMatches?.matches[0].id).toBe(fresh.id);
    expect(input.value).toBe("fresh");
  });

  it("lets ctrl+f take over a host locate panel", async () => {
    const element = API.createElement({ type: "text", text: "alpha" });
    API.setElements([element]);

    openPanel({
      mode: "locate",
      items: [{ elementId: element.id, label: "Alpha item" }],
    });
    expect(queryPanel()).toHaveLength(1);
    expect(queryFilterInput()).not.toBeNull();

    act(() => {
      Keyboard.withModifierKeys({ ctrl: true }, () => {
        Keyboard.keyPress(KEYS.F);
      });
    });

    const input = await querySearchInput();
    expect(input.matches(":focus")).toBe(true);
    await waitFor(() => {
      expect(getContainer().textContent).not.toContain("Alpha item");
    });
    expect(h.app.state.openSidebar).not.toBeNull();

    closePanel();
    expect(h.app.state.openSidebar).not.toBeNull();
  });

  it("closes a host-opened panel but leaves a user-opened one alone", async () => {
    openPanel({ mode: "search", query: "" });
    expect(h.app.state.openSidebar).not.toBeNull();

    closePanel();
    expect(h.app.state.openSidebar).toBeNull();
    expect(queryPanel()).toHaveLength(0);

    act(() => {
      Keyboard.withModifierKeys({ ctrl: true }, () => {
        Keyboard.keyPress(KEYS.F);
      });
    });
    await querySearchInput();
    expect(h.app.state.openSidebar).not.toBeNull();

    closePanel();
    expect(h.app.state.openSidebar).not.toBeNull();
  });
});
