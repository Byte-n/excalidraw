import React from "react";
import { vi } from "vitest";

import { reseed } from "@excalidraw/common";

import { Excalidraw } from "../index";
import * as StaticScene from "../renderer/staticScene";
import {
  act,
  render,
  queryByTestId,
  unmountComponent,
} from "../tests/test-utils";

const renderStaticScene = vi.spyOn(StaticScene, "renderStaticScene");

describe("Test <App/>", () => {
  beforeEach(async () => {
    unmountComponent();
    localStorage.clear();
    renderStaticScene.mockClear();
    reseed(7);
  });

  it("should show error modal when using brave and measureText API is not working", async () => {
    (global.navigator as any).brave = {
      isBrave: {
        name: "isBrave",
      },
    };

    const originalContext = global.HTMLCanvasElement.prototype.getContext("2d");
    //@ts-ignore
    global.HTMLCanvasElement.prototype.getContext = (contextId) => {
      return {
        ...originalContext,
        measureText: () => ({
          width: 0,
        }),
      };
    };

    await render(<Excalidraw />);
    expect(
      queryByTestId(
        document.querySelector(".excalidraw-modal-container")!,
        "brave-measure-text-error",
      ),
    ).toMatchSnapshot();
  });

  it("keeps viewport notification, store commit, and change notification ordering", async () => {
    const events: string[] = [];
    const onChange = vi.fn(() => events.push("onChange"));
    const onScrollChange = vi.fn(() => events.push("onScrollChange"));

    await render(
      <Excalidraw onChange={onChange} onScrollChange={onScrollChange} />,
    );

    onChange.mockClear();
    onScrollChange.mockClear();
    events.length = 0;
    const commit = vi.spyOn(window.h.app.store, "commit");
    commit.mockClear();

    act(() => {
      window.h.app.api.updateScene({ appState: { scrollX: 42 } });
    });

    expect(onScrollChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["onScrollChange", "onChange"]);
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(
      onChange.mock.invocationCallOrder[0],
    );
    commit.mockRestore();
  });
});
