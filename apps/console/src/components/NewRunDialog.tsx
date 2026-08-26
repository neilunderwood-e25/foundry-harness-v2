import { useEffect, useState } from "react";
import { CloseIcon } from "./Icons.js";
import { parseDeliveryDocument } from "../model.js";

interface NewRunDialogProps {
  readonly open: boolean;
  readonly initialDocument: unknown | undefined;
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly onClose: () => void;
  readonly onSubmit: (document: unknown) => void;
}

export function NewRunDialog(props: NewRunDialogProps) {
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState<string>();

  useEffect(() => {
    if (!props.open) return;
    setValue(props.initialDocument ? JSON.stringify(props.initialDocument, null, 2) : "");
    setLocalError(undefined);
  }, [props.initialDocument, props.open]);

  useEffect(() => {
    if (!props.open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !props.pending) props.onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [props]);

  const submit = () => {
    try {
      setLocalError(undefined);
      props.onSubmit(parseDeliveryDocument(value));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  if (!props.open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="new-run-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-run-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">New delivery</span>
            <h2 id="new-run-title">Launch a component batch</h2>
            <p>Paste a validated delivery document. Credentials stay in the server environment.</p>
          </div>
          <button className="icon-button" onClick={props.onClose} disabled={props.pending}>
            <CloseIcon />
            <span className="sr-only">Close</span>
          </button>
        </header>
        <label className="json-editor-label" htmlFor="delivery-json">
          Delivery JSON
          <span>schemaVersion 1</span>
        </label>
        <textarea
          id="delivery-json"
          className="json-editor"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={'{\n  "schemaVersion": 1,\n  "project": { ... }\n}'}
          spellCheck={false}
          autoFocus
        />
        {(localError ?? props.error) && (
          <div className="dialog-error" role="alert">
            {localError ?? props.error}
          </div>
        )}
        <footer>
          <button className="text-button" onClick={props.onClose} disabled={props.pending}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={submit}
            disabled={props.pending || !value.trim()}
          >
            {props.pending ? "Starting…" : "Start delivery"}
          </button>
        </footer>
      </section>
    </div>
  );
}
