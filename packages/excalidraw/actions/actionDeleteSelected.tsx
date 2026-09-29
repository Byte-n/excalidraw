import {
  KEYS,
  MOBILE_ACTION_BUTTON_BG,
  updateActiveTool,
} from "@excalidraw/common";

import { getNonDeletedElements } from "@excalidraw/element";
import { fixBindingsAfterDeletion } from "@excalidraw/element";
import { LinearElementEditor } from "@excalidraw/element";
import { newElementWith } from "@excalidraw/element";
import { getContainerSubtreeElements } from "@excalidraw/element";
import {
  isBoundToContainer,
  isElbowArrow,
  isFrameLikeElement,
  isTableElement,
} from "@excalidraw/element";

import {
  getElementsInGroup,
  selectGroupsForSelectedElements,
} from "@excalidraw/element";

import { CaptureUpdateAction } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { t } from "../i18n";
import { getSelectedElements, isSomeElementSelected } from "../scene";
import { TrashIcon } from "../components/icons";
import { IconButton } from "../components/IconButton";

import { useStylesPanelMode } from "../components/App";

import { register } from "./register";

import type { AppClassProperties, AppState } from "../types";

const deleteSelectedElements = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  app: AppClassProperties,
) => {
  const selectedContainers = getSelectedElements(elements, appState).filter(
    (el) => isFrameLikeElement(el) || isTableElement(el),
  );
  const containerSubtreeIds = new Set<ExcalidrawElement["id"]>();
  const elementsMap = app.scene.getNonDeletedElementsMap();
  for (const container of selectedContainers) {
    for (const member of getContainerSubtreeElements(
      elements,
      container.id,
      elementsMap,
    )) {
      containerSubtreeIds.add(member.id);
    }
  }

  const selectedElementIds: Record<ExcalidrawElement["id"], true> = {};

  const nextElements = elements.map((el) => {
    if (containerSubtreeIds.has(el.id)) {
      if (el.boundElements) {
        el.boundElements.forEach((candidate) => {
          const bound = app.scene.getNonDeletedElementsMap().get(candidate.id);
          if (bound && isElbowArrow(bound)) {
            app.scene.mutateElement(bound, {
              startBinding:
                el.id === bound.startBinding?.elementId
                  ? null
                  : bound.startBinding,
              endBinding:
                el.id === bound.endBinding?.elementId ? null : bound.endBinding,
            });
          }
        });
      }
      return newElementWith(el, {
        isDeleted: true,
        containerRef: el.containerRef ? undefined : el.containerRef,
      });
    }

    if (appState.selectedElementIds[el.id]) {
      if (el.boundElements) {
        el.boundElements.forEach((candidate) => {
          const bound = app.scene.getNonDeletedElementsMap().get(candidate.id);
          if (bound && isElbowArrow(bound)) {
            app.scene.mutateElement(bound, {
              startBinding:
                el.id === bound.startBinding?.elementId
                  ? null
                  : bound.startBinding,
              endBinding:
                el.id === bound.endBinding?.elementId ? null : bound.endBinding,
            });
          }
        });
      }
      return newElementWith(el, { isDeleted: true });
    }

    if (isBoundToContainer(el) && appState.selectedElementIds[el.containerId]) {
      return newElementWith(el, { isDeleted: true });
    }
    return el;
  });

  let nextEditingGroupId = appState.editingGroupId;

  // select next eligible element in currently editing group or supergroup
  if (appState.editingGroupId) {
    const elems = getElementsInGroup(
      nextElements,
      appState.editingGroupId,
    ).filter((el) => !el.isDeleted);
    if (elems.length > 1) {
      if (elems[0]) {
        selectedElementIds[elems[0].id] = true;
      }
    } else {
      nextEditingGroupId = null;
      if (elems[0]) {
        selectedElementIds[elems[0].id] = true;
      }

      const lastElementInGroup = elems[0];
      if (lastElementInGroup) {
        const editingGroupIdx = lastElementInGroup.groupIds.findIndex(
          (groupId) => {
            return groupId === appState.editingGroupId;
          },
        );
        const superGroupId = lastElementInGroup.groupIds[editingGroupIdx + 1];
        if (superGroupId) {
          const elems = getElementsInGroup(nextElements, superGroupId).filter(
            (el) => !el.isDeleted,
          );
          if (elems.length > 1) {
            nextEditingGroupId = superGroupId;

            elems.forEach((el) => {
              selectedElementIds[el.id] = true;
            });
          }
        }
      }
    }
  }

  return {
    elements: nextElements,
    appState: {
      ...appState,
      ...selectGroupsForSelectedElements(
        {
          selectedElementIds,
          editingGroupId: nextEditingGroupId,
        },
        getNonDeletedElements(nextElements),
        appState,
        null,
      ),
    },
  };
};

const handleGroupEditingState = (
  appState: AppState,
  elements: readonly ExcalidrawElement[],
): AppState => {
  if (appState.editingGroupId) {
    const siblingElements = getElementsInGroup(
      getNonDeletedElements(elements),
      appState.editingGroupId!,
    );
    if (siblingElements.length) {
      return {
        ...appState,
        selectedElementIds: { [siblingElements[0].id]: true },
      };
    }
  }
  return appState;
};

export const actionDeleteSelected = register({
  name: "deleteSelectedElements",
  label: "labels.delete",
  icon: TrashIcon,
  trackEvent: { category: "element", action: "delete" },
  perform: (elements, appState, formData, app) => {
    // a selected table row/column claims Delete before the element
    // selection: the removal (cells + members, recursively) is one undo
    // entry (phase-1.md:96)
    if (appState.tableRowColSelection) {
      if (app.deleteSelectedTableRowCol()) {
        return {
          elements: app.scene.getElementsIncludingDeleted(),
          appState: {
            ...appState,
            tableRowColSelection: null,
          },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        };
      }
    }
    if (app.mindmap.hasSelectedMindmapElement()) {
      if (app.mindmap.getSelectedNode()) {
        return app.mindmap.getDeleteActionResult();
      }
      const graphElements = app.mindmap.deleteCompleteSelectedGraphs(elements);
      if (!graphElements) {
        return false;
      }
      const ordinarySelectedElementIds: Record<string, true> = {};
      graphElements.forEach((element) => {
        if (!element.isDeleted && appState.selectedElementIds[element.id]) {
          ordinarySelectedElementIds[element.id] = true;
        }
      });
      const { elements: nextElements, appState: nextAppState } =
        deleteSelectedElements(
          graphElements,
          { ...appState, selectedElementIds: ordinarySelectedElementIds },
          app,
        );
      fixBindingsAfterDeletion(
        nextElements,
        nextElements.filter((element) => element.isDeleted),
      );
      const nonDeletedIds = new Set(
        nextElements
          .filter((element) => !element.isDeleted)
          .map(({ id }) => id),
      );
      return {
        elements: nextElements,
        appState: {
          ...nextAppState,
          selectedElementIds: Object.fromEntries(
            Object.keys(nextAppState.selectedElementIds)
              .filter((id) => nonDeletedIds.has(id))
              .map((id) => [id, true]),
          ),
          previousSelectedElementIds: {},
          selectedLinearElement: null,
          hoveredElementIds: {},
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      };
    }
    if (appState.selectedLinearElement?.isEditing) {
      const { elementId, selectedPointsIndices } =
        appState.selectedLinearElement;
      const elementsMap = app.scene.getNonDeletedElementsMap();
      const linearElement = LinearElementEditor.getElement(
        elementId,
        elementsMap,
      );
      if (!linearElement) {
        return false;
      }
      // case: no point selected → do nothing, as deleting the whole element
      // is most likely a mistake, where you wanted to delete a specific point
      // but failed to select it (or you thought it's selected, while it was
      // only in a hover state)
      if (selectedPointsIndices == null) {
        return false;
      }

      // case: deleting all points
      if (selectedPointsIndices.length >= linearElement.points.length) {
        const nextElements = elements.map((el) => {
          if (el.id === linearElement.id) {
            return newElementWith(el, { isDeleted: true });
          }
          return el;
        });
        const nextAppState = handleGroupEditingState(appState, nextElements);

        return {
          elements: nextElements,
          appState: {
            ...nextAppState,
            selectedLinearElement: null,
          },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        };
      }

      LinearElementEditor.deletePoints(
        linearElement,
        app,
        selectedPointsIndices,
      );

      return {
        elements,
        appState: {
          ...appState,
          selectedLinearElement: {
            ...appState.selectedLinearElement,
            selectedPointsIndices:
              selectedPointsIndices?.[0] > 0
                ? [selectedPointsIndices[0] - 1]
                : [0],
          },
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      };
    }

    let { elements: nextElements, appState: nextAppState } =
      deleteSelectedElements(elements, appState, app);

    fixBindingsAfterDeletion(
      nextElements,
      nextElements.filter((el) => el.isDeleted),
    );

    nextAppState = handleGroupEditingState(nextAppState, nextElements);

    return {
      elements: nextElements,
      appState: {
        ...nextAppState,
        activeTool: updateActiveTool(appState, {
          type: app.state.preferredSelectionTool.type,
        }),
        multiElement: null,
        newElement: null,
        activeEmbeddable: null,
        selectedLinearElement: null,
      },
      // deleting a table removes its complete subtree — a structural
      // operation that must be committed atomically, not lazily
      // (phase-1.md:68, :126)
      captureUpdate: getSelectedElements(elements, appState).some((element) =>
        isTableElement(element),
      )
        ? CaptureUpdateAction.IMMEDIATELY
        : isSomeElementSelected(
            getNonDeletedElements(elements),
            appState,
          )
        ? CaptureUpdateAction.IMMEDIATELY
        : CaptureUpdateAction.EVENTUALLY,
    };
  },
  keyTest: (event, appState, elements) =>
    (event.key === KEYS.BACKSPACE || event.key === KEYS.DELETE) &&
    !event[KEYS.CTRL_OR_CMD],
  PanelComponent: ({ elements, appState, updateData, app }) => {
    const isMobile = useStylesPanelMode() === "mobile";

    return (
      <IconButton
        type="button"
        icon={TrashIcon}
        title={t("labels.delete")}
        aria-label={t("labels.delete")}
        onClick={() => updateData(null)}
        disabled={
          !isSomeElementSelected(getNonDeletedElements(elements), appState)
        }
        style={{
          ...(isMobile && appState.openPopup !== "compactOtherProperties"
            ? MOBILE_ACTION_BUTTON_BG
            : {}),
        }}
      />
    );
  },
});
