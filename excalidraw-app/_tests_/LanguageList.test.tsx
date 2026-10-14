import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import { defaultLang, languages } from "@excalidraw/excalidraw/i18n";
import { UI } from "@excalidraw/excalidraw/_tests_/helpers/ui";
import {
  screen,
  fireEvent,
  waitFor,
  render,
} from "@excalidraw/excalidraw/_tests_/test-utils";

import { LanguageList } from "../app-language/LanguageList";
import { useAppLangCode } from "../app-language/language-state";
import { Provider } from "../app-jotai";

const TEST_LANG_CODE = "fr-FR";

const TestApp = () => {
  const [langCode] = useAppLangCode();

  return (
    <Excalidraw langCode={langCode}>
      <MainMenu>
        <MainMenu.ItemCustom>
          <LanguageList />
        </MainMenu.ItemCustom>
      </MainMenu>
    </Excalidraw>
  );
};

describe("Test LanguageList", () => {
  it("rerenders UI on language change", async () => {
    expect(languages.some((lang) => lang.code === TEST_LANG_CODE)).toBe(true);

    await render(
      <Provider>
        <TestApp />
      </Provider>,
    );

    // 选择一个会展示浮动工具配置栏的工具（rectangle 在无选区时不展示，
    // 见 FloatingShapeActions 的 TOOL_CONFIG_BAR_TOOLS），line 支持描边宽度，
    // 「样式」弹层内含 `thin` 分段选择器可用于校验多语言重渲染
    UI.clickTool("line");
    // 描边宽度分段选择器在浮动栏「样式」弹层内（T3 场景矩阵）
    (global as any).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("[aria-label='Styles']")!,
    );
    // english lang should display `thin` label
    expect(screen.queryByTitle(/thin/i)).not.toBeNull();
    fireEvent.click(document.querySelector(".dropdown-menu-button")!);

    fireEvent.change(document.querySelector(".dropdown-select__language")!, {
      target: { value: TEST_LANG_CODE },
    });
    // switching to French, `thin` label should no longer exist
    await waitFor(() => expect(screen.queryByTitle(/thin/i)).toBeNull());
    // reset language
    fireEvent.change(document.querySelector(".dropdown-select__language")!, {
      target: { value: defaultLang.code },
    });
    // 主菜单交互关闭了「样式」弹层，重新打开
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("[aria-label='Styles']")!,
    );
    // switching back to English
    await waitFor(() => expect(screen.queryByTitle(/thin/i)).not.toBeNull());
  });
});
