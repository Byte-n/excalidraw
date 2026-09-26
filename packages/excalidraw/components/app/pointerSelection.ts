import { isSelectionLikeTool, updateActiveTool } from "@excalidraw/common";
import { makeNextSelectedElementIds } from "@excalidraw/element";

/** Selection state transitions used by pointer down/up handlers. */
export const clearSelectionIfNotUsingSelection = (app: any): void => {
  if (!isSelectionLikeTool(app.state.activeTool.type)) {
    app.setState({
      selectedElementIds: makeNextSelectedElementIds({}, app.state),
      selectedGroupIds: {},
      editingGroupId: null,
      activeEmbeddable: null,
    });
  }
};

export const isASelectedElement = (
  app: any,
  hitElement: { id: string } | null,
): boolean => !!hitElement && !!app.state.selectedElementIds[hitElement.id];

/** Restores selection tool state after a completed pointer gesture. */
export const restoreSelectionTool = (app: any) => {
  if (
    !app.isToolLocked() &&
    app.state.activeTool.type !== "freedraw" &&
    app.state.activeTool.type !== "bucketfill" &&
    (app.state.activeTool.type !== "lasso" ||
      app.state.activeTool.fromSelection)
  ) {
    app.setState(
      {
        newElement: null,
        suggestedBinding: null,
        activeTool: updateActiveTool(app.state, {
          type: app.state.preferredSelectionTool.type,
        }),
      },
      () => {
        app.cursor.reset();
        app.cursor.refreshHover();
      },
    );
  }
};
