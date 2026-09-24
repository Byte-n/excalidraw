import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import {
  getMindmapSubtreeIds,
  reparentMindmapNodes,
} from "@excalidraw/element";

import type { ExcalidrawMindmapNodeElement } from "@excalidraw/element/types";

import { useUIAppState } from "../context/ui-appState";
import { useSceneNonce } from "../hooks/useSceneNonce";
import { t } from "../i18n";

import { useApp } from "./App";
import DropdownMenu from "./dropdownMenu/DropdownMenu";
import {
  DotsIcon,
  PlusIcon,
  TrashIcon,
  TextIcon,
  chevronDownIcon,
  chevronRight,
  mindmapIcon,
  upIcon,
} from "./icons";
import { getMindmapOutlines } from "./mindmapOutlineModel";

import "./MindmapOutline.scss";

import type { MindmapOutlineGraph } from "./mindmapOutlineModel";
import type { DragEvent, ReactNode } from "react";

type DropPosition = "before" | "inside" | "after";

const getDropPosition = (
  node: ExcalidrawMindmapNodeElement,
  event: DragEvent<HTMLElement>,
): DropPosition => {
  if (node.role === "root") {
    return "inside";
  }
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  return ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
};

const getDropTarget = (
  graph: MindmapOutlineGraph,
  node: ExcalidrawMindmapNodeElement,
  position: DropPosition,
) => {
  if (position === "inside") {
    return { parentId: node.id, beforeId: null };
  }
  const siblings = graph.index.childrenById.get(node.parentId!) ?? [];
  return {
    parentId: node.parentId!,
    beforeId:
      position === "before"
        ? node.id
        : siblings[siblings.indexOf(node.id) + 1] ?? null,
  };
};

type OutlineTreeProps = {
  graph: MindmapOutlineGraph;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onToggle?: (id: string) => void;
  onStartRename?: (id: string) => void;
  editing?: { id: string; value: string } | null;
  onEditChange?: (value: string) => void;
  onEditFinish?: (commit: boolean) => void;
  renderActions?: (node: ExcalidrawMindmapNodeElement) => ReactNode;
  draggedId?: string | null;
  onDragStart?: (id: string, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onDrop?: (nodeId: string, position: DropPosition, draggedId: string) => void;
};

const OutlineRow = ({
  graph,
  nodeId,
  depth,
  selectedId,
  onSelect,
  onToggle,
  onStartRename,
  editing,
  onEditChange,
  onEditFinish,
  renderActions,
  draggedId,
  onDragStart,
  onDragEnd,
  onDrop,
}: OutlineTreeProps & { nodeId: string; depth: number }) => {
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
  const skipBlurRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing?.id === nodeId) {
      inputRef.current?.focus();
    }
  }, [editing?.id, nodeId]);
  const node = graph.index.nodes.get(nodeId)!;
  const children = graph.index.childrenById.get(nodeId) ?? [];
  const canDrop = (position: DropPosition) => {
    if (!draggedId || draggedId === nodeId) {
      return false;
    }
    const dragged = graph.index.nodes.get(draggedId);
    if (!dragged || dragged.role === "root") {
      return false;
    }
    const target = getDropTarget(graph, node, position);
    if (
      getMindmapSubtreeIds(graph.index, draggedId).includes(target.parentId)
    ) {
      return false;
    }
    try {
      reparentMindmapNodes(
        graph.index,
        [draggedId],
        target.parentId,
        target.beforeId,
      );
      return true;
    } catch {
      return false;
    }
  };

  return (
    <li
      role="treeitem"
      aria-selected={selectedId === nodeId}
      aria-expanded={children.length ? !node.collapsed : undefined}
    >
      <div
        className={clsx("mindmap-outline-row", {
          selected: selectedId === nodeId,
          [`drop-${dropPosition}`]: dropPosition,
        })}
        style={{ paddingInlineStart: depth * 16 + 8 }}
        draggable={!!onDragStart && node.role !== "root"}
        onDragStart={(event) => onDragStart?.(nodeId, event)}
        onDragEnd={onDragEnd}
        onDragOver={(event) => {
          const position = getDropPosition(node, event);
          if (canDrop(position)) {
            event.preventDefault();
            setDropPosition(position);
          } else {
            setDropPosition(null);
          }
        }}
        onDragLeave={() => setDropPosition(null)}
        onDrop={(event) => {
          event.preventDefault();
          const position = getDropPosition(node, event);
          if (draggedId && canDrop(position)) {
            onDrop?.(nodeId, position, draggedId);
          }
          setDropPosition(null);
        }}
      >
        {children.length ? (
          <button
            type="button"
            className="mindmap-outline-toggle"
            aria-label={t(
              node.collapsed ? "outline.expand" : "outline.collapse",
            )}
            onClick={() => onToggle?.(nodeId)}
          >
            {node.collapsed ? chevronRight : chevronDownIcon}
          </button>
        ) : (
          <span className="mindmap-outline-spacer" />
        )}
        {editing?.id === nodeId ? (
          <input
            className="mindmap-outline-label mindmap-outline-input"
            aria-label={t("outline.renameNode", {
              name: graph.labels.get(nodeId)!,
            })}
            value={editing.value}
            ref={inputRef}
            onFocus={() => {
              skipBlurRef.current = false;
            }}
            onChange={(event) => onEditChange?.(event.target.value)}
            onBlur={() => {
              if (!skipBlurRef.current) {
                onEditFinish?.(true);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                skipBlurRef.current = true;
                onEditFinish?.(event.key === "Enter");
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="mindmap-outline-label"
            title={graph.labels.get(nodeId)}
            onClick={() => onSelect?.(nodeId)}
            onDoubleClick={() => onStartRename?.(nodeId)}
          >
            {graph.labels.get(nodeId)}
          </button>
        )}
        {renderActions?.(node)}
      </div>
      {!node.collapsed && children.length > 0 && (
        <ul role="group">
          {children.map((id) => (
            <OutlineRow
              key={id}
              graph={graph}
              nodeId={id}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
              onStartRename={onStartRename}
              editing={editing}
              onEditChange={onEditChange}
              onEditFinish={onEditFinish}
              renderActions={renderActions}
              draggedId={draggedId}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

/** Scene-derived hierarchy; omit callbacks to render an import or AI preview. */
export const MindmapOutlineTree = (props: OutlineTreeProps) => (
  <ul className="mindmap-outline-tree" role="tree">
    <OutlineRow {...props} nodeId={props.graph.index.rootId} depth={0} />
  </ul>
);

const NodeActions = ({
  node,
  label,
  onRename,
}: {
  node: ExcalidrawMindmapNodeElement;
  label: string;
  onRename: (id: string, label: string) => void;
}) => {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const editable = app.mindmap.canEditNode(node.id);
  return (
    <DropdownMenu open={open}>
      <DropdownMenu.Trigger
        className="mindmap-outline-actions"
        title={t("outline.actions", { name: label })}
        aria-label={t("outline.actions", { name: label })}
        onToggle={() => setOpen(!open)}
      >
        {DotsIcon}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        onClickOutside={() => setOpen(false)}
        onSelect={() => setOpen(false)}
      >
        <DropdownMenu.Item
          disabled={!editable}
          icon={TextIcon}
          onSelect={() => onRename(node.id, label)}
        >
          {t("outline.rename")}
        </DropdownMenu.Item>
        <DropdownMenu.Item
          disabled={!editable}
          icon={PlusIcon}
          onSelect={() => app.mindmap.createChild(node.id)}
        >
          {t("outline.addChild")}
        </DropdownMenu.Item>
        {node.role !== "root" && (
          <DropdownMenu.Item
            disabled={!editable}
            icon={PlusIcon}
            onSelect={() => app.mindmap.createSibling(node.id)}
          >
            {t("outline.addSibling")}
          </DropdownMenu.Item>
        )}
        {node.role !== "root" && (
          <DropdownMenu.Item
            disabled={!editable}
            icon={upIcon}
            onSelect={() => app.mindmap.promote(node.id)}
          >
            {t("outline.promote")}
          </DropdownMenu.Item>
        )}
        <DropdownMenu.Item
          disabled={!editable}
          icon={TrashIcon}
          onSelect={() =>
            app.syncActionResult(
              app.mindmap.getDeleteActionResult(true, node.id),
            )
          }
        >
          {t("outline.deleteKeepChildren")}
        </DropdownMenu.Item>
        <DropdownMenu.Item
          disabled={!editable}
          icon={TrashIcon}
          onSelect={() =>
            app.mindmap.executeTreeCommand({ type: "delete" }, node.id)
          }
        >
          {t("outline.deleteBranch")}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
};

export const MindmapOutline = () => {
  const app = useApp();
  const appState = useUIAppState();
  useSceneNonce(app.scene);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(
    null,
  );
  const graphs = getMindmapOutlines(app.scene.getNonDeletedElements());
  const selectedId = Object.keys(appState.selectedElementIds).find((id) =>
    graphs.some((graph) => graph.index.nodes.has(id)),
  );

  return (
    <div className="mindmap-outline">
      {graphs.length === 0 && (
        <div className="mindmap-outline-empty">{t("outline.empty")}</div>
      )}
      {graphs.map((graph) => (
        <section key={graph.graphId} className="mindmap-outline-graph">
          <div className="mindmap-outline-graph-title">
            {mindmapIcon}
            <span>
              {t("outline.graph", { number: graph.number })}: {graph.title}
            </span>
          </div>
          <MindmapOutlineTree
            graph={graph}
            selectedId={selectedId}
            onSelect={(id) => app.mindmap.focusNode(id)}
            onStartRename={(id) =>
              setEditing({ id, value: graph.labels.get(id)! })
            }
            editing={editing}
            onEditChange={(value) =>
              setEditing((current) => current && { ...current, value })
            }
            onEditFinish={(commit) => {
              if (commit && editing) {
                app.mindmap.renameNode(editing.id, editing.value);
              }
              setEditing(null);
            }}
            onToggle={(id) =>
              app.mindmap.executeTreeCommand({ type: "toggleCollapse" }, id)
            }
            renderActions={(node) => (
              <NodeActions
                node={node}
                label={graph.labels.get(node.id)!}
                onRename={(id, label) => setEditing({ id, value: label })}
              />
            )}
            draggedId={draggedId}
            onDragStart={(id, event) => {
              setDraggedId(id);
              event.dataTransfer.setData("text/plain", id);
            }}
            onDragEnd={() => setDraggedId(null)}
            onDrop={(nodeId, position, sourceId) => {
              const target = getDropTarget(
                graph,
                graph.index.nodes.get(nodeId)!,
                position,
              );
              app.mindmap.reparentNode(
                sourceId,
                target.parentId,
                target.beforeId,
              );
              setDraggedId(null);
            }}
          />
        </section>
      ))}
    </div>
  );
};
