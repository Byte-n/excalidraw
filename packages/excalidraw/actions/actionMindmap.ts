import { register } from "./register";

import type { Action } from "./types";

const canEdit: Action["predicate"] = (_elements, _state, _props, app) => {
  const node = app.mindmap.getSelectedNode();
  return !!node && app.mindmap.canEditNode(node.id);
};

export const actionMindmapCreateChild = register({
  name: "mindmapCreateChild",
  label: "labels.addMindmapChild",
  trackEvent: false,
  predicate: canEdit,
  perform: (_elements, _state, _value, app) => {
    const node = app.mindmap.getSelectedNode();
    if (node) {
      app.mindmap.createChild(node.id);
    }
    return false;
  },
});

export const actionMindmapCreateSibling = register({
  name: "mindmapCreateSibling",
  label: "labels.addMindmapSibling",
  trackEvent: false,
  predicate: canEdit,
  perform: (_elements, _state, _value, app) => {
    const node = app.mindmap.getSelectedNode();
    if (node) {
      app.mindmap.createSibling(node.id);
    }
    return false;
  },
});

export const actionMindmapToggleCollapse = register({
  name: "mindmapToggleCollapse",
  label: (_elements, _state, app) =>
    app.mindmap.getSelectedNode()?.collapsed
      ? "labels.expandMindmap"
      : "labels.collapseMindmap",
  trackEvent: false,
  predicate: (...args) => {
    const node = args[3].mindmap.getSelectedNode();
    return canEdit(...args) && !!node && args[3].mindmap.hasChildren(node.id);
  },
  perform: (_elements, _state, _value, app) =>
    app.mindmap.getTreeActionResult({ type: "toggleCollapse" }),
});

export const actionMindmapDeletePreservingChildren = register({
  name: "mindmapDeletePreservingChildren",
  label: "labels.deleteMindmapPreservingChildren",
  trackEvent: false,
  predicate: canEdit,
  perform: (_elements, _state, _value, app) =>
    app.mindmap.getDeleteActionResult(true),
});

export const actionMindmapPromote = register({
  name: "mindmapPromote",
  label: "labels.promoteMindmap",
  trackEvent: false,
  predicate: (...args) =>
    canEdit(...args) && args[3].mindmap.getSelectedNode()?.role === "node",
  perform: (_elements, _state, _value, app) =>
    app.mindmap.getPromoteActionResult(),
});
