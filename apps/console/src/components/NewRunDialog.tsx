import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Play } from "lucide-react";
import { useEffect, useState } from "react";
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

  const submit = () => {
    try {
      setLocalError(undefined);
      props.onSubmit(parseDeliveryDocument(value));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && !props.pending && props.onClose()}>
      <DialogContent className="max-w-3xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Launch a component batch</DialogTitle>
          <DialogDescription>
            Paste a schema-version-1 delivery document. Credentials remain in the server
            environment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium" htmlFor="delivery-json">
              Delivery JSON
            </label>
            <span className="font-mono text-xs text-muted-foreground">schemaVersion 1</span>
          </div>
          <Textarea
            id="delivery-json"
            className="min-h-96 resize-y bg-slate-950 font-mono text-xs leading-relaxed text-slate-100 selection:bg-primary/40"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={'{\n  "schemaVersion": 1,\n  "project": { ... }\n}'}
            spellCheck={false}
            autoFocus
          />
        </div>

        {(localError ?? props.error) && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Unable to start delivery</AlertTitle>
            <AlertDescription>{localError ?? props.error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={props.onClose} disabled={props.pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={props.pending || !value.trim()}>
            <Play data-icon="inline-start" />
            {props.pending ? "Starting…" : "Start delivery"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
