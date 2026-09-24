import React, { useRef, useState } from "react";

import {
  getMindmapTextTree,
  parseMindmapText,
  serializeMindmapText,
} from "../data/mindmapText";
import { fileSave } from "../data/filesystem";
import { t, useI18n } from "../i18n";

import { useApp, useExcalidrawElements, useExcalidrawSetAppState } from "./App";
import { Dialog } from "./Dialog";
import DialogActionButton from "./DialogActionButton";
import DropdownMenu from "./dropdownMenu/DropdownMenu";
import { ExportIcon, LoadIcon } from "./icons";

import "./MindmapTextDialog.scss";

import type { MindmapTextFormat } from "../data/mindmapText";

const FORMAT_LABELS: Record<MindmapTextFormat, string> = {
  markdown: "Markdown",
  outline: "Outline",
  opml: "OPML",
};

const formatFromName = (name: string): MindmapTextFormat => {
  const extension = name.toLowerCase().split(".").pop();
  return extension === "opml"
    ? "opml"
    : extension === "md" || extension === "markdown"
    ? "markdown"
    : "outline";
};

export const MindmapTextDialog = () => {
  const app = useApp();
  const setAppState = useExcalidrawSetAppState();
  const elements = useExcalidrawElements();
  const { langCode } = useI18n();
  const [format, setFormat] = useState<MindmapTextFormat>("markdown");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedNode = app.mindmap.getSelectedNode();
  const selectedRoot = app.mindmap.getSelectedGraphRoot();
  const exportRoot = selectedNode ?? selectedRoot;

  const close = () => setAppState({ openDialog: null });
  const parse = () => {
    try {
      const tree = parseMindmapText(text, format, app.ownerDocument);
      app.mindmap.importTextTree(tree);
      close();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };

  const exportText = async (nextFormat: MindmapTextFormat) => {
    try {
      const target =
        exportRoot ??
        elements.find((element) => element.type === "mindmap-node");
      if (!target || target.type !== "mindmap-node") {
        app.setAppState({ toast: { message: t("mindmapText.noMindmap") } });
        return;
      }
      const tree = getMindmapTextTree(elements, target.graphId, exportRoot?.id);
      const serialized = serializeMindmapText(tree, nextFormat);
      await fileSave(
        new app.ownerWindow.Blob([serialized], {
          type:
            nextFormat === "opml"
              ? "application/xml"
              : nextFormat === "markdown"
              ? "text/markdown"
              : "text/plain",
        }),
        {
          name: app.getName() || "mindmap",
          extension:
            nextFormat === "markdown"
              ? "md"
              : nextFormat === "opml"
              ? "opml"
              : "txt",
          description: FORMAT_LABELS[nextFormat],
        },
      );
      app.setAppState({
        toast: {
          message: t("mindmapText.exported", {
            format: FORMAT_LABELS[nextFormat],
          }),
        },
      });
    } catch (value) {
      app.setAppState({
        toast: {
          message: value instanceof Error ? value.message : String(value),
        },
      });
    }
  };

  return (
    <Dialog
      onCloseRequest={close}
      title={t("mindmapText.importTitle")}
      size="wide"
    >
      <div className="mindmap-text-dialog">
        <div className="mindmap-text-dialog__toolbar">
          <label>
            {t("mindmapText.format")}
            <select
              value={format}
              onChange={(event) =>
                setFormat(event.target.value as MindmapTextFormat)
              }
            >
              {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="mindmap-text-dialog__file"
            onClick={() => fileInputRef.current?.click()}
          >
            {LoadIcon} {t("mindmapText.chooseFile")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,.opml,text/plain,text/markdown,application/xml"
            hidden
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) {
                return;
              }
              try {
                setFormat(formatFromName(file.name));
                setText(await file.text());
                setError(null);
              } catch (value) {
                setError(
                  value instanceof Error ? value.message : String(value),
                );
              }
              event.currentTarget.value = "";
            }}
          />
        </div>
        <textarea
          className="mindmap-text-dialog__input"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          placeholder={t("mindmapText.placeholder")}
          aria-label={t("mindmapText.inputLabel")}
          spellCheck={false}
        />
        {error && (
          <div className="mindmap-text-dialog__error" role="alert">
            {error}
          </div>
        )}
        <p className="mindmap-text-dialog__hint">{t("mindmapText.lossHint")}</p>
        <div className="mindmap-text-dialog__actions">
          <DialogActionButton label={t("buttons.cancel")} onClick={close} />
          <DialogActionButton
            label={t("mindmapText.import")}
            actionType="primary"
            onClick={parse}
            disabled={!text.trim()}
          />
        </div>
        <div className="mindmap-text-dialog__exports">
          <span>{t("mindmapText.exportTitle")}</span>
          {(Object.keys(FORMAT_LABELS) as MindmapTextFormat[]).map((value) => (
            <button
              key={`${langCode}-${value}`}
              type="button"
              onClick={() => exportText(value)}
            >
              {ExportIcon} {FORMAT_LABELS[value]}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
};

export const MindmapTextExportItems = () => {
  const app = useApp();
  const elements = useExcalidrawElements();
  const selectedNode = app.mindmap.getSelectedNode();
  const selectedRoot = app.mindmap.getSelectedGraphRoot();
  const exportRoot = selectedNode ?? selectedRoot;
  const exportText = async (format: MindmapTextFormat) => {
    try {
      const target =
        exportRoot ??
        elements.find((element) => element.type === "mindmap-node");
      if (!target || target.type !== "mindmap-node") {
        app.setAppState({ toast: { message: t("mindmapText.noMindmap") } });
        return;
      }
      const tree = getMindmapTextTree(elements, target.graphId, exportRoot?.id);
      await fileSave(
        new app.ownerWindow.Blob([serializeMindmapText(tree, format)], {
          type:
            format === "opml"
              ? "application/xml"
              : format === "markdown"
              ? "text/markdown"
              : "text/plain",
        }),
        {
          name: app.getName() || "mindmap",
          extension:
            format === "markdown" ? "md" : format === "opml" ? "opml" : "txt",
          description: FORMAT_LABELS[format],
        },
      );
    } catch (value) {
      app.setAppState({
        toast: {
          message: value instanceof Error ? value.message : String(value),
        },
      });
    }
  };
  return (
    <>
      {(Object.keys(FORMAT_LABELS) as MindmapTextFormat[]).map((format) => (
        <DropdownMenu.Item
          key={format}
          icon={ExportIcon}
          onSelect={() => exportText(format)}
        >
          {t("mindmapText.exportFormat", { format: FORMAT_LABELS[format] })}
        </DropdownMenu.Item>
      ))}
    </>
  );
};
