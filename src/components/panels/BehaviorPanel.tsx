/**
 * Behavior panel: the ethogram, Label Behaviors mode, the labelled bouts of the video on
 * screen, and the predicted bouts to review. Labels are sleap-io events
 * (`lib/behaviorEvents.ts`), so they open in LUC3D and Python sleap-io as they are.
 */
import { useMemo, useState } from "react";
import type { Event, EventParticipant, EventType } from "@talmolab/sleap-io.js";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useBehaviorStore } from "@/stores/behaviorStore";
import { confirmDialog } from "@/stores/confirmStore";
import { commandContext } from "@/commands/CommandContext";
import {
  AcceptPrediction,
  AddBehavior,
  DeleteBout,
  EditBout,
  RejectPrediction,
  RemoveBehavior,
  UpdateBehavior,
} from "@/commands/behaviorCommands";
import {
  BEHAVIOR_COLORS,
  NOT_LABEL_COLOR,
  behaviorAnimals,
  behaviorColor,
  behaviorFieldProblem,
  behaviorFields,
  behaviorOfEvent,
  boutWho,
  ethogram,
  eventsForVideo,
  isNotType,
  isPrediction,
  predictionStatus,
  type BehaviorFields,
  type ReviewStatus,
} from "@/lib/behaviorEvents";
import { focalAnimal, setBehaviorMode } from "@/lib/behaviorCoding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** A frame as the app shows it (0-based, with separators). */
function frameText(idx: number): string {
  return idx.toLocaleString("en-US");
}

function spanText(e: Event): string {
  return e.isInstantaneous
    ? frameText(e.startFrame)
    : `${frameText(e.startFrame)}–${frameText(e.endFrame)}`;
}

type PairChoice = "one" | "directed" | "mutual";

/** Add or edit one behavior. */
function BehaviorDialog({
  open,
  type,
  onClose,
}: {
  open: boolean;
  type: EventType | null;
  onClose: () => void;
}) {
  const labels = useAppStore((s) => s.labels);
  const initial = type ? behaviorFields(type) : null;
  const [name, setName] = useState(initial?.name ?? "");
  const [key, setKey] = useState(initial?.key ?? "");
  const [color, setColor] = useState(initial?.color ?? "");
  const [kind, setKind] = useState<"state" | "point">(initial?.kind ?? "state");
  const [pair, setPair] = useState<PairChoice>(
    initial?.mutual ? "mutual" : initial?.directed ? "directed" : "one",
  );
  const [group, setGroup] = useState(initial?.group ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const fallbackColor =
    BEHAVIOR_COLORS[(labels ? ethogram(labels).length : 0) % BEHAVIOR_COLORS.length];

  const save = () => {
    if (!labels) return;
    const fields: BehaviorFields = {
      name,
      key,
      color: color || (type ? behaviorColor(labels, type) : ""),
      kind,
      directed: pair !== "one",
      mutual: pair === "mutual",
      group,
      description,
    };
    const why = behaviorFieldProblem(labels, fields, type ?? undefined);
    if (why) {
      setProblem(why);
      return;
    }
    void commandContext.execute(type ? UpdateBehavior : AddBehavior, {
      type,
      fields,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{type ? "Edit behavior" : "Add behavior"}</DialogTitle>
          <DialogDescription>
            Behaviors are saved in the project, and LUC3D and Python sleap-io read them too.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Label htmlFor="behavior-name">Name</Label>
          <Input
            id="behavior-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Label htmlFor="behavior-key">Key</Label>
          <Input
            id="behavior-key"
            className="w-16"
            maxLength={1}
            placeholder="none"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            title="One letter, pressed in Label Behaviors mode. Digits pick the animal."
          />
          <Label htmlFor="behavior-color">Color</Label>
          <input
            id="behavior-color"
            type="color"
            className="h-7 w-16 rounded border border-border bg-transparent"
            value={color || (type && labels ? behaviorColor(labels, type) : fallbackColor)}
            onChange={(e) => setColor(e.target.value)}
          />
          <Label>Length</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as "state" | "point")}>
            <SelectTrigger data-testid="behavior-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="state">Has a start and an end</SelectItem>
              <SelectItem value="point">One frame</SelectItem>
            </SelectContent>
          </Select>
          <Label>Animals</Label>
          <Select value={pair} onValueChange={(v) => setPair(v as PairChoice)}>
            <SelectTrigger data-testid="behavior-pair">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="one">One animal</SelectItem>
              <SelectItem value="directed">One animal to another</SelectItem>
              <SelectItem value="mutual">A pair, no actor and target</SelectItem>
            </SelectContent>
          </Select>
          <Label htmlFor="behavior-group">Group</Label>
          <Input
            id="behavior-group"
            placeholder="none"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            title="Behaviors in one group exclude each other for one animal."
          />
          <Label htmlFor="behavior-description">Description</Label>
          <Input
            id="behavior-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {problem && (
            <p className="col-span-2 text-xs text-destructive" role="alert">
              {problem}
            </p>
          )}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} data-testid="behavior-save">
            {type ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Edit one bout's frames and note. */
function BoutDialog({ bout, onClose }: { bout: Event; onClose: () => void }) {
  const [start, setStart] = useState(String(bout.startFrame));
  const [end, setEnd] = useState(String(bout.endFrame));
  const [note, setNote] = useState(bout.metadata.note ?? "");
  const lo = Number(start);
  const hi = Number(end);
  const valid =
    start.trim() !== "" &&
    end.trim() !== "" &&
    Number.isInteger(lo) &&
    Number.isInteger(hi) &&
    lo >= 0 &&
    hi >= lo;
  const save = () => {
    if (!valid) return;
    void commandContext.execute(EditBout, {
      bout,
      changes: { startFrame: lo, endFrame: hi, note },
    });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit bout</DialogTitle>
          <DialogDescription>
            {bout.type.name}
            {boutWho(bout) ? ` · ${boutWho(bout)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Label htmlFor="bout-start">First frame</Label>
          <Input id="bout-start" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} />
          <Label htmlFor="bout-end">Last frame</Label>
          <Input id="bout-end" inputMode="numeric" value={end} onChange={(e) => setEnd(e.target.value)} />
          <Label htmlFor="bout-note">Note</Label>
          <Input id="bout-note" value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_TEXT: Record<ReviewStatus, string> = {
  open: "",
  accepted: "Accepted",
  rejected: "Rejected",
  mixed: "Partly",
};

export function BehaviorPanel() {
  const labels = useAppStore((s) => s.labels);
  const video = useAppStore((s) => s.video);
  const setFrameIdx = useAppStore((s) => s.setFrameIdx);
  // Re-read labels.events after an edit (edits replace the array in place on `labels`).
  const editSeq = useAppStore((s) => s.editSeq);
  const mode = useBehaviorStore((s) => s.mode);
  const setBehaviorState = useBehaviorStore((s) => s.set);
  useBehaviorStore((s) => s.focal);

  const [dialog, setDialog] = useState<{ open: boolean; type: EventType | null }>({
    open: false,
    type: null,
  });
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<Event | null>(null);

  const events = useMemo(
    () => (labels && video ? eventsForVideo(labels, video) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editSeq re-reads labels.events after an edit.
    [labels, video, editSeq],
  );

  if (!labels) {
    return <div className="p-3 text-xs text-muted-foreground">Open a project to label behaviors.</div>;
  }

  const types = ethogram(labels);
  const animals = behaviorAnimals(labels) as EventParticipant[];
  const focal = focalAnimal(labels);
  const boutsOf = (t: EventType) =>
    events.filter((e) => !e.isPredicted && e.type === t).length;

  const bouts = events
    .filter((e) => !e.isPredicted)
    .filter((e) => filter === "all" || behaviorOfEvent(labels, e)?.name === filter)
    .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  const predictions = events
    .filter(isPrediction)
    .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);

  const removeType = async (t: EventType) => {
    const n = labels.events.filter((e) => behaviorOfEvent(labels, e) === t).length;
    if (
      n > 0 &&
      !(await confirmDialog({
        title: "Delete behavior",
        message: `Delete "${t.name}" and its ${n.toLocaleString("en-US")} bout${n === 1 ? "" : "s"}?`,
      }))
    ) {
      return;
    }
    void commandContext.execute(RemoveBehavior, { type: t });
  };

  return (
    <div className="flex flex-col gap-3 p-2 text-xs" data-testid="behavior-panel">
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant={mode ? "default" : "secondary"}
          onClick={() => setBehaviorMode(!mode)}
          disabled={!types.length}
          title="Letters code behaviors, digits pick the animal, [ and ] mark a range, Esc leaves (Ctrl/Cmd+Shift+L)"
          data-testid="behavior-mode"
        >
          {mode ? "Labelling: on" : "Label behaviors"}
        </Button>
        {!types.length && (
          <span className="text-muted-foreground">Add a behavior first.</span>
        )}
      </div>

      {animals.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground">Animal</span>
          {animals.map((a, i) => (
            <Button
              key={`${a.name}:${i}`}
              size="xs"
              variant={a === focal ? "default" : "ghost"}
              onClick={() => setBehaviorState({ focal: a })}
              title={i < 9 ? `Key ${i + 1} in Label Behaviors mode` : undefined}
            >
              {i < 9 ? `${i + 1} ` : ""}
              {a.name}
            </Button>
          ))}
        </div>
      )}

      <section>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold">Behaviors</span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setDialog({ open: true, type: null })}
            data-testid="behavior-add"
          >
            <Plus /> Add
          </Button>
        </div>
        {types.length === 0 ? (
          <p className="text-muted-foreground">No behaviors yet.</p>
        ) : (
          <ul className="flex flex-col">
            {types.map((t) => {
              const f = behaviorFields(t);
              return (
                <li
                  key={t.name}
                  className="group flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent/50"
                  title={t.description || undefined}
                  data-testid="behavior-row"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: behaviorColor(labels, t) }}
                  />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {f.mutual ? (
                    <span className="text-muted-foreground" title="A pair, no actor and target">
                      ↔
                    </span>
                  ) : f.directed ? (
                    <span className="text-muted-foreground" title="One animal to another">
                      →
                    </span>
                  ) : null}
                  {f.key && (
                    <kbd className="rounded border border-border px-1 font-mono text-[10px]">{f.key}</kbd>
                  )}
                  <span className="w-8 text-right tabular-nums text-muted-foreground">
                    {boutsOf(t).toLocaleString("en-US")}
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => setDialog({ open: true, type: t })}
                    aria-label={`Edit ${t.name}`}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => void removeType(t)}
                    aria-label={`Delete ${t.name}`}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="font-semibold">Bouts ({bouts.length.toLocaleString("en-US")})</span>
          {types.length > 0 && (
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger size="sm" className="h-6 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All behaviors</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t.name} value={t.name}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {bouts.length === 0 ? (
          <p className="text-muted-foreground">
            {types.length ? "Nothing labelled on this video." : ""}
          </p>
        ) : (
          <ul className="flex flex-col">
            {bouts.map((e, i) => (
              <li
                key={i}
                className="group flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent/50"
                onClick={() => setFrameIdx(e.startFrame)}
                title={[e.type.name, boutWho(e), spanText(e), e.metadata.note].filter(Boolean).join(" · ")}
                data-testid="bout-row"
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-sm"
                  style={{
                    backgroundColor: isNotType(e.type)
                      ? NOT_LABEL_COLOR
                      : behaviorColor(labels, e.type),
                  }}
                />
                <span className={cn("min-w-0 flex-1 truncate", isNotType(e.type) && "text-muted-foreground")}>
                  {e.type.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{boutWho(e)}</span>
                <span className="shrink-0 tabular-nums">{spanText(e)}</span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="Edit bout"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setEditing(e);
                  }}
                >
                  <Pencil />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="shrink-0"
                  aria-label="Delete bout"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    void commandContext.execute(DeleteBout, { bout: e });
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {predictions.length > 0 && (
        <section>
          <div className="mb-1 font-semibold">
            Predictions to review ({predictions.length.toLocaleString("en-US")})
          </div>
          <ul className="flex flex-col gap-0.5">
            {predictions.map((e, i) => {
              const status = predictionStatus(labels, e);
              return (
                <li
                  key={i}
                  className="cursor-pointer rounded px-1 py-0.5 hover:bg-accent/50"
                  onClick={() => setFrameIdx(e.startFrame)}
                  title={e.source ? `From ${e.source}` : undefined}
                  data-testid="prediction-row"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-sm opacity-60"
                      style={{ backgroundColor: behaviorColor(labels, e.type) }}
                    />
                    <span className="min-w-0 flex-1 truncate">{e.type.name}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{boutWho(e)}</span>
                    <span className="shrink-0 tabular-nums">{spanText(e)}</span>
                  </div>
                  <div className="flex items-center justify-end gap-1 pl-3.5">
                    {e.score !== null && (
                      <span className="mr-auto tabular-nums text-muted-foreground">
                        {Math.round(e.score * 100)}%
                      </span>
                    )}
                    {status !== "open" ? (
                      <span className="text-muted-foreground">{STATUS_TEXT[status]}</span>
                    ) : (
                      <>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void commandContext.execute(AcceptPrediction, { prediction: e });
                          }}
                        >
                          Accept
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void commandContext.execute(RejectPrediction, { prediction: e });
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {editing && <BoutDialog bout={editing} onClose={() => setEditing(null)} />}
      {dialog.open && (
        <BehaviorDialog
          key={dialog.type?.name ?? "new"}
          open
          type={dialog.type}
          onClose={() => setDialog({ open: false, type: null })}
        />
      )}
    </div>
  );
}
