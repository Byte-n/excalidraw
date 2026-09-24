import React from "react";

import { KEYS } from "@excalidraw/common";

import { Excalidraw } from "../index";
import { defaultLang, setLanguage, t } from "../i18n";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, fireEvent, render, screen, waitFor, within } from "./test-utils";

describe("shortcuts", () => {
  describe("HelpDialog 脑图快捷键说明", () => {
    afterEach(async () => {
      await act(async () => setLanguage(defaultLang));
    });

    it.each(["en", "zh-CN"])(
      "%s 显示创建、导航、折叠、提升及新的删除规则",
      async (langCode) => {
        await render(<Excalidraw handleKeyboardGlobally langCode={langCode} />);
        await waitFor(() =>
          expect(window.h.app.ownerDocument.documentElement.lang).toBe(
            langCode,
          ),
        );
        Keyboard.keyPress("?");
        const heading = await screen.findByRole("heading", {
          level: 4,
          name: langCode === "en" ? "Mindmap" : "思维导图",
        });
        const section = heading.closest(".HelpDialog__island")! as HTMLElement;
        const help = within(section);
        const shortcuts = [
          ["labels.addMindmapChild", ["Tab"]],
          ["labels.addMindmapSibling", [t("keys.enter")]],
          ["helpDialog.mindmap.previousSibling", ["↑"]],
          ["helpDialog.mindmap.nextSibling", ["↓"]],
          ["helpDialog.mindmap.parent", ["←"]],
          ["helpDialog.mindmap.firstChild", ["→"]],
          ["helpDialog.mindmap.toggleCollapse", [t("keys.spacebar")]],
          ["helpDialog.mindmap.promote", [t("keys.shift"), "Tab"]],
          ["labels.deleteMindmapSubtree", [t("keys.delete"), "Backspace"]],
          [
            "labels.deleteMindmapPreservingChildren",
            [t("keys.shift"), t("keys.delete"), t("keys.shift"), "Backspace"],
          ],
          ["helpDialog.editText", [t("helpDialog.doubleClick")]],
        ] as const;
        for (const [label, keys] of shortcuts) {
          const row = help
            .getByText(t(label))
            .closest(".HelpDialog__shortcut")!;
          expect(
            Array.from(row.querySelectorAll("kbd"), (key) => key.textContent),
          ).toEqual(keys);
        }
        expect(
          help.getByText(t("helpDialog.mindmap.context")),
        ).toBeInTheDocument();
        expect(
          help.getByText(t("helpDialog.mindmap.deleteHint")),
        ).toBeInTheDocument();
        expect(
          help.getByText(t("helpDialog.mindmap.preserveHint")),
        ).toBeInTheDocument();
        fireEvent.keyDown(section, { key: "Escape" });
        expect(window.h.state.openDialog).toBeNull();
      },
    );
  });

  it("Clear canvas shortcut should display confirm dialog", async () => {
    await render(
      <Excalidraw
        initialData={{ elements: [API.createElement({ type: "rectangle" })] }}
        handleKeyboardGlobally
      />,
    );

    expect(window.h.elements.length).toBe(1);

    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyDown(KEYS.DELETE);
    });
    const confirmDialog = document.querySelector(".confirm-dialog")!;
    expect(confirmDialog).not.toBe(null);

    fireEvent.click(confirmDialog.querySelector('[aria-label="Confirm"]')!);

    await waitFor(() => {
      expect(window.h.elements[0].isDeleted).toBe(true);
    });
  });
});
