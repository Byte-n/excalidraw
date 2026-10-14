import { KEYS } from "@excalidraw/common";

import { Excalidraw } from "../../index";
import { Keyboard } from "../../_tests_/helpers/ui";
import { act, render } from "../../_tests_/test-utils";

describe("FontPicker", () => {
  it("should be able to open font picker", async () => {
    (global as any).ResizeObserver =
      (global as any).ResizeObserver ||
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      };

    const { queryByTestId } = await render(
      <Excalidraw handleKeyboardGlobally={true} />,
    );

    Keyboard.keyPress(KEYS.T);

    const fontPickerTrigger = queryByTestId("font-family-show-fonts");

    expect(fontPickerTrigger).not.toBeNull();

    act(() => {
      fontPickerTrigger!.click();
    });
  });
});
