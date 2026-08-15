import {
  memo,
  useEffect,
  useMemo,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import type { ReactElement, Ref } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { baseExtensions, loadLanguageExtension } from "@/lib/codemirror-setup";

export type CodeMirrorEditorHandle = {
  /** Returns the underlying EditorView instance, or null if not mounted. */
  getView: () => EditorView | null;
  /** Focuses the editor. */
  focus: () => void;
};

export type CodeMirrorEditorProps = {
  /** Source text rendered in the editor. */
  content: string;
  /** Language identifier (e.g. "markdown", "ts", "python"). Resolved lazily. */
  language?: string;
  /** When true the editor is non-editable (reader-first default). */
  readOnly?: boolean;
  /** Called with the latest document text on user edits. */
  onChange?: (value: string) => void;
  /** Extra CodeMirror extensions appended after the base set. */
  extensions?: Extension[];
  /** Optional className applied to the host element. */
  className?: string;
};

function applyDoc(view: EditorView, content: string): void {
  const current = view.state.doc.toString();
  if (current === content) return;
  view.dispatch({
    changes: { from: 0, to: current.length, insert: content },
  });
}

function CodeMirrorEditorImpl(
  props: CodeMirrorEditorProps,
  ref: Ref<CodeMirrorEditorHandle>,
): ReactElement {
  const {
    content,
    language,
    readOnly = true,
    onChange,
    extensions,
    className,
  } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      getView: () => viewRef.current,
      focus: () => viewRef.current?.focus(),
    }),
    [],
  );

  // Stable update listener bound to the latest onChange closure. The listener
  // extension is created once; onChangeRef keeps the callback fresh without
  // recreating the extension.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const updateListener = useMemo(
    () =>
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged && onChangeRef.current) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    [],
  );

  // Base extensions + readOnly + update listener. Stable across renders unless
  // readOnly flips.
  const baseExts = useMemo(() => {
    const exts: Extension[] = [...baseExtensions(), updateListener];
    if (readOnly) {
      exts.push(EditorState.readOnly.of(true));
    }
    return exts;
  }, [readOnly, updateListener]);

  // Caller-provided extensions. Memoized by reference; callers should memoize.
  const extraExts = useMemo(() => extensions ?? [], [extensions]);

  // Create the editor once.
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [...baseExts, ...extraExts],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the document in sync when the `content` prop changes externally.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    applyDoc(view, content);
  }, [content]);

  // Reconfigure the full extension set when base/extra extensions change.
  // Uses setState to swap extensions while preserving the current document and
  // selection cursor where possible.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.setState(
      EditorState.create({
        doc: view.state.doc.toString(),
        extensions: [...baseExts, ...extraExts],
      }),
    );
  }, [baseExts, extraExts]);

  // Lazily attach a language extension when the `language` prop resolves.
  // Loaded language support is appended to the current extension set.
  useEffect(() => {
    if (!language) return;
    let cancelled = false;
    (async () => {
      const ext = await loadLanguageExtension(language);
      if (cancelled || !ext || !viewRef.current) return;
      const current = viewRef.current.state;
      viewRef.current.setState(
        EditorState.create({
          doc: current.doc.toString(),
          extensions: [...baseExts, ...extraExts, ext],
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [language, baseExts, extraExts]);

  return (
    <div
      ref={hostRef}
      className={["cm-marloues-host", className].filter(Boolean).join(" ")}
      data-language={language ?? "text"}
      data-readonly={readOnly ? "true" : "false"}
    />
  );
}

export const CodeMirrorEditor = memo(forwardRef(CodeMirrorEditorImpl)) as (
  props: CodeMirrorEditorProps & { ref?: Ref<CodeMirrorEditorHandle> },
) => ReactElement;
