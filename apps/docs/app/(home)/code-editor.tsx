/**
 * @file Interactive read-only NT project preview on the documentation homepage.
 *
 * Rotates static example files inside a VS Code-style shell and lets visitors
 * select a file manually. Source data and presentation tokenization live in
 * focused sibling modules, keeping this client component concerned only with
 * state, timing, accessibility, and rendering.
 */

"use client";

import { useEffect, useState } from "react";
import { FolderIcon, NtFileIcon } from "@/components/logos";
import { PREVIEW_FILES } from "./code-editor-files";
import { tokenizePreview } from "./code-editor-tokenize";

/**
 * Renders the code editor component from its documented props.
 * @returns The self-advancing, keyboard-accessible NT source preview.
 */
export function CodeEditor() {
  const [active, setActive] = useState(0);
  const file = PREVIEW_FILES[active];
  const lines = tokenizePreview(file.content);

  useEffect(() => {
    const id = setTimeout(() => setActive((current) => (current + 1) % PREVIEW_FILES.length), 5200);
    return () => clearTimeout(id);
  }, [active]);

  const rootFiles = PREVIEW_FILES.filter((candidate) => !candidate.folder);
  const folderFiles = PREVIEW_FILES.filter((candidate) => candidate.folder);

  return (
    <div className="nt-vscode nt-reveal" data-delay="2">
      <div className="nt-vscode-title">
        <span className="nt-vscode-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="nt-vscode-titletext">{file.name} — example</span>
      </div>

      <div className="nt-vscode-body">
        <div className="nt-vscode-activity">
          <span className="on" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path
                fill="currentColor"
                d="M20.9 7.9 12 3 3.1 7.9 12 12.8l8.9-4.9ZM3 9.4v7.2L11 21v-7.2L3 9.4Zm10 4.4V21l8-4.4V9.4l-8 4.4Z"
              />
            </svg>
          </span>
          <span aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path
                fill="currentColor"
                d="M10 4a6 6 0 1 0 3.7 10.7l4.8 4.8 1.4-1.4-4.8-4.8A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"
              />
            </svg>
          </span>
          <span aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path
                fill="currentColor"
                d="M6 3a3 3 0 0 0-1 5.8V15a3 3 0 1 0 2 0V8.8A3 3 0 0 0 6 3Zm12 0a3 3 0 0 0-1 5.8V9a3 3 0 0 1-3 3h-2v-1l-3 2 3 2v-1h2a5 5 0 0 0 5-5v-.2A3 3 0 0 0 18 3Z"
              />
            </svg>
          </span>
        </div>

        <div className="nt-vscode-side">
          <div className="nt-vscode-sidehead">Explorer</div>
          <div className="nt-vscode-folder">
            <span className="chev">⌄</span>
            <FolderIcon size={15} /> example
          </div>
          {rootFiles.map((candidate) => (
            <button
              key={candidate.id}
              className={`nt-vscode-file${candidate.id === file.id ? " on" : ""}`}
              onClick={() => setActive(PREVIEW_FILES.indexOf(candidate))}
            >
              <NtFileIcon size={15} />
              {candidate.name}
            </button>
          ))}
          <div className="nt-vscode-folder sub">
            <span className="chev">⌄</span>
            <FolderIcon size={15} /> subagents
          </div>
          {folderFiles.map((candidate) => (
            <button
              key={candidate.id}
              className={`nt-vscode-file sub${candidate.id === file.id ? " on" : ""}`}
              onClick={() => setActive(PREVIEW_FILES.indexOf(candidate))}
            >
              <NtFileIcon size={15} />
              {candidate.name}
            </button>
          ))}
        </div>

        <div className="nt-vscode-main">
          <div className="nt-vscode-tabs">
            <span className="nt-vscode-tab on">
              <NtFileIcon size={15} />
              {file.name}
            </span>
          </div>
          <div className="nt-vscode-code" key={file.id}>
            {lines.map((segments, lineIndex) => (
              <div
                className="nt-ed-line"
                key={lineIndex}
                style={{ animationDelay: `${Math.min(lineIndex * 16, 520)}ms` }}
              >
                <span className="nt-ed-gutter">{lineIndex + 1}</span>
                <span className="nt-ed-text">
                  {segments.map((segment, segmentIndex) =>
                    segment.c ? (
                      <span className={`t-${segment.c}`} key={segmentIndex}>
                        {segment.t}
                      </span>
                    ) : (
                      <span key={segmentIndex}>{segment.t}</span>
                    ),
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="nt-vscode-status">
            <span>NT</span>
            <span>UTF-8</span>
            <span>Spaces: 2</span>
            <span className="grow" />
            <span>Ln {lines.length}, Col 1</span>
          </div>
        </div>
      </div>
    </div>
  );
}
