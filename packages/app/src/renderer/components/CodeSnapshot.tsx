import { useEffect, useRef } from "react";
import { json } from "@codemirror/lang-json";
import { lineNumbers } from "@codemirror/view";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { EditorState } from "@codemirror/state";
import { EditorView } from "codemirror";
import { tags } from "@lezer/highlight";
import s from "./CodeSnapshot.module.css";

const languages = { json: json(), shell: StreamLanguage.define(shell) };

export const highlight = syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.propertyName, tags.variableName], color: "light-dark(#17528c, #9cdcfe)" },
  { tag: tags.string, color: "light-dark(#9b3417, #f1ac8a)" },
  { tag: tags.number, color: "light-dark(#246440, #b5cea8)" },
  { tag: [tags.keyword, tags.bool, tags.null, tags.atom], color: "light-dark(#6d388e, #d4a8ec)" },
  { tag: tags.comment, color: "light-dark(#526055, #a6b5a4)" },
  { tag: tags.heading, fontWeight: "bold", color: "light-dark(#17528c, #9cdcfe)" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "light-dark(#17528c, #9cdcfe)", textDecoration: "underline" },
  { tag: tags.monospace, color: "light-dark(#9b3417, #f1ac8a)" },
  { tag: [tags.processingInstruction, tags.list, tags.quote], color: "light-dark(#526055, #a6b5a4)" },
]));

const theme = EditorView.theme({
  ".cm-scroller": { maxHeight: "30rem", overflow: "auto", fontFamily: "var(--mono)" },
  ".cm-content": { padding: "10px 0" },
  ".cm-line": { padding: "0 12px" },
});

export function CodeSnapshot({ content, language, label, numbered = false }: {
  content: string; language?: keyof typeof languages; label: string; numbered?: boolean;
}) {
  const parent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!parent.current) return;
    const editor = new EditorView({
      parent: parent.current,
      doc: content,
      extensions: [
        language ? languages[language] : [], numbered ? lineNumbers() : [], highlight, theme,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ tabindex: "0", "aria-readonly": "true", "aria-label": label }),
      ],
    });
    return () => editor.destroy();
  }, [content, language, label, numbered]);

  return <div ref={parent} className={s.snapshot} />;
}
