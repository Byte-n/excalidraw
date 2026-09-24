import { useState } from "react";

import {
  buildMindmapGraphIndex,
  getBoundTextElement,
  isMindmapNodeElement,
} from "@excalidraw/element";

import { t } from "../i18n";

import { Dialog } from "./Dialog";
import DialogActionButton from "./DialogActionButton";

import type { AppClassProperties } from "../types";

export const MindmapRootDeleteDialog = ({
  app,
  nodeId,
}: {
  app: AppClassProperties;
  nodeId: string;
}) => {
  const [replacementId, setReplacementId] = useState("");
  const node = app.scene.getNonDeletedElement(nodeId);
  const [initialTarget] = useState(() =>
    node && isMindmapNodeElement(node)
      ? { graphId: node.graphId, parentId: node.parentId }
      : null,
  );
  const isRoot = isMindmapNodeElement(node) && node.role === "root";
  const index =
    node && isMindmapNodeElement(node)
      ? buildMindmapGraphIndex(app.scene.getNonDeletedElements(), node.graphId)
      : null;
  const children = index?.childrenById.get(nodeId) ?? [];
  const close = () =>
    app.setAppState({ openDialog: null }, () => app.focusContainer());
  const confirm = (replacement?: string) => {
    // 对话框打开后场景可能被替换，确认时重新校验，不能删除过期目标。
    const current = app.scene.getNonDeletedElement(nodeId);
    if (
      !current ||
      !isMindmapNodeElement(current) ||
      current.graphId !== initialTarget?.graphId ||
      current.parentId !== initialTarget?.parentId
    ) {
      close();
      return;
    }
    const currentChildren =
      buildMindmapGraphIndex(
        app.scene.getNonDeletedElements(),
        current.graphId,
      ).childrenById.get(nodeId) ?? [];
    if (
      (replacement !== undefined && !currentChildren.includes(replacement)) ||
      (replacement === undefined &&
        current.role === "root" &&
        currentChildren.length > 1)
    ) {
      close();
      return;
    }
    app.mindmap.executeTreeCommand(
      { type: "deletePreservingChildren", replacementId: replacement },
      nodeId,
    );
    close();
  };
  return (
    <Dialog
      title={t(
        isRoot ? "labels.deleteMindmapRoot" : "labels.deleteMindmapNode",
      )}
      size="small"
      onCloseRequest={close}
    >
      <p>
        {t(
          isRoot
            ? "labels.deleteMindmapRootHint"
            : "labels.deleteMindmapNodeHint",
        )}
      </p>
      {children.length > 0 && (
        <label
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          {t(isRoot ? "labels.mindmapNewRoot" : "labels.mindmapReplacement")}
          <select
            aria-label={t(
              isRoot ? "labels.mindmapNewRoot" : "labels.mindmapReplacement",
            )}
            value={replacementId}
            onChange={(event) => setReplacementId(event.target.value)}
          >
            <option value="">{t("labels.mindmapChooseRoot")}</option>
            {children.map((id) => (
              <option key={id} value={id}>
                {getBoundTextElement(
                  index!.nodes.get(id)!,
                  app.scene.getNonDeletedElementsMap(),
                )?.originalText || t("labels.mindmapUntitled")}
              </option>
            ))}
          </select>
        </label>
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "flex-end",
          gap: 12,
        }}
      >
        <DialogActionButton label={t("buttons.cancel")} onClick={close} />
        {!isRoot && (
          <DialogActionButton
            label={t("labels.promoteMindmapChildren")}
            disabled={!index}
            onClick={() => confirm()}
          />
        )}
        <DialogActionButton
          label={t(
            isRoot ? "labels.keepMindmapBranches" : "labels.replaceMindmapNode",
          )}
          disabled={!children.includes(replacementId)}
          onClick={() => confirm(replacementId)}
        />
      </div>
    </Dialog>
  );
};
