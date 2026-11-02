/**
 * Label Behaviors mode: what its keys do. The same keys as LUC3D's mode, so someone
 * coding in both apps does not have to relearn them:
 *
 *   a letter      a behavior's key. A state starts and stops with it; a point labels
 *                 the frame. With a range selected (`[` then `]`, or Shift+drag on the
 *                 seekbar) it labels the whole range. Shift+letter labels the range "not".
 *   1-9           pick the animal the keys label, or a directed behavior's target
 *   [  ]          start a range here / end it here
 *   Esc           cancel a pending target, else leave the mode
 *
 * Everything else falls through to the app's own shortcuts (arrows step frames, Mod+Z undoes).
 */
import type { EventParticipant, EventType, Labels, Video } from "@talmolab/sleap-io.js";
import { commandContext } from "@/commands/CommandContext";
import { LabelBehaviorRange } from "@/commands/behaviorCommands";
import { useAppStore } from "@/stores/appStore";
import { useBehaviorStore } from "@/stores/behaviorStore";
import { toast } from "@/lib/notify";
import {
  behaviorAnimals,
  behaviorFields,
  ethogram,
  labelRange,
} from "@/lib/behaviorEvents";

/** The animal the keys label: the chosen one while it exists, else the first. */
export function focalAnimal(labels: Labels): EventParticipant | null {
  const animals = behaviorAnimals(labels);
  const { focal } = useBehaviorStore.getState();
  if (focal && (animals as EventParticipant[]).includes(focal)) return focal;
  return animals[0] ?? null;
}

/** Enter or leave the mode. Leaving stops whatever is running, at the current frame. */
export function setBehaviorMode(on: boolean): void {
  const store = useBehaviorStore.getState();
  if (store.mode === on) return;
  if (!on) stopAllRunning();
  store.set({ mode: on, pendingTarget: null, rangeStart: null });
}

/** The range a key should label, if any: the seekbar's selection. */
function selectedRange(): [number, number] | null {
  return useAppStore.getState().frameRange;
}

function sameRunning(
  r: { type: EventType; subject: EventParticipant | null },
  type: EventType,
  subject: EventParticipant | null,
): boolean {
  return r.type === type && r.subject === subject;
}

/** Stop every running state, as labelled bouts ending at the current frame. */
export function stopAllRunning(): void {
  const { running } = useBehaviorStore.getState();
  const { frameIdx } = useAppStore.getState();
  for (const r of running) {
    void commandContext.execute(LabelBehaviorRange, {
      type: r.type,
      video: r.video,
      subject: r.subject,
      target: r.target,
      start: r.start,
      end: Math.max(frameIdx, r.start),
    });
  }
  useBehaviorStore.getState().set({ running: [] });
}

/**
 * Write what is still running as ending at the current frame, without stopping it, so a
 * save holds it. It replaces the same span when it does stop. Not an undo step.
 */
export function flushRunningBehaviors(): void {
  const { running } = useBehaviorStore.getState();
  const { labels, frameIdx, markEventsChanged } = useAppStore.getState();
  if (!labels || !running.length) return;
  for (const r of running) {
    labelRange(labels, {
      type: r.type,
      video: r.video,
      subject: r.subject,
      target: r.target,
      start: r.start,
      end: Math.max(frameIdx, r.start),
    });
  }
  markEventsChanged();
}

/** Do what a behavior's key does, once its animals are known. */
function applyBehavior(
  type: EventType,
  subject: EventParticipant | null,
  target: EventParticipant | null,
  present: boolean,
): void {
  const { video, frameIdx } = useAppStore.getState();
  if (!video) return;
  const fields = behaviorFields(type);
  const range = selectedRange();
  if (range || fields.kind === "point" || !present) {
    const [start, end] = range ?? [frameIdx, frameIdx];
    void commandContext.execute(LabelBehaviorRange, {
      type,
      video,
      subject,
      target,
      start,
      end,
      present,
    });
    return;
  }
  // A state: the key starts and stops it. Two animals can do the same behavior at once;
  // one animal's run of a directed behavior stops whichever target it has.
  const store = useBehaviorStore.getState();
  const running = store.running.find((r) => sameRunning(r, type, subject));
  if (running) {
    store.set({ running: store.running.filter((r) => r !== running) });
    void commandContext.execute(LabelBehaviorRange, {
      type,
      video: running.video,
      subject,
      target: running.target,
      start: running.start,
      end: Math.max(frameIdx, running.start),
    });
    return;
  }
  store.set({
    running: [
      ...store.running,
      { type, video: video as Video, subject, target, start: frameIdx },
    ],
  });
}

/** A behavior's key was pressed. */
export function pressBehavior(type: EventType, present: boolean): void {
  const { labels } = useAppStore.getState();
  if (!labels) return;
  const fields = behaviorFields(type);
  const subject = focalAnimal(labels);
  if (!fields.directed) {
    applyBehavior(type, subject, null, present);
    return;
  }
  if (!subject) {
    toast.info(`"${type.name}" is between two animals, and this project has none yet.`);
    return;
  }
  // A running directed bout stops with its key, whichever target it has.
  const running = useBehaviorStore
    .getState()
    .running.find((r) => sameRunning(r, type, subject));
  if (running) {
    applyBehavior(type, subject, running.target, present);
    return;
  }
  const others = (behaviorAnimals(labels) as EventParticipant[]).filter(
    (a) => a !== subject,
  );
  if (others.length === 0) {
    toast.info(`"${type.name}" needs a second animal.`);
    return;
  }
  if (others.length === 1) {
    applyBehavior(type, subject, others[0], present);
    return;
  }
  useBehaviorStore.getState().set({
    pendingTarget: { type, actor: subject, present },
  });
}

/** A digit was pressed: the target a directed behavior waits for, else the focal animal. */
export function pressAnimalDigit(digit: number): void {
  const { labels } = useAppStore.getState();
  if (!labels) return;
  const animal = (behaviorAnimals(labels) as EventParticipant[])[digit - 1];
  if (!animal) return;
  const store = useBehaviorStore.getState();
  const pending = store.pendingTarget;
  if (pending) {
    if (animal === pending.actor) return;
    store.set({ pendingTarget: null });
    applyBehavior(pending.type, pending.actor, animal, pending.present);
    return;
  }
  store.set({ focal: animal });
}

/** `[`: start a range at this frame. */
export function markRangeStart(): void {
  const { frameIdx, set } = useAppStore.getState();
  useBehaviorStore.getState().set({ rangeStart: frameIdx });
  set("frameRange", null);
}

/** `]`: end the range at this frame, selecting it on the seekbar. */
export function markRangeEnd(): void {
  const { frameIdx, set } = useAppStore.getState();
  const store = useBehaviorStore.getState();
  if (store.rangeStart === null) return;
  const lo = Math.min(store.rangeStart, frameIdx);
  const hi = Math.max(store.rangeStart, frameIdx);
  set("frameRange", [lo, hi]);
  store.set({ rangeStart: null });
}

/**
 * The mode's key handler. Returns true when it took the key. Plain keys only (Shift for a
 * "not" label over a range; any other modifier is someone else's shortcut).
 */
export function handleBehaviorKey(e: KeyboardEvent): boolean {
  const store = useBehaviorStore.getState();
  if (!store.mode || e.metaKey || e.ctrlKey) return false;
  const { labels } = useAppStore.getState();
  if (!labels) return false;
  if (e.key === "Escape") {
    if (store.pendingTarget) store.set({ pendingTarget: null });
    else setBehaviorMode(false);
    return true;
  }
  if (e.key === "[") {
    markRangeStart();
    return true;
  }
  if (e.key === "]") {
    markRangeEnd();
    return true;
  }
  if (/^[1-9]$/.test(e.key) && !e.altKey) {
    pressAnimalDigit(Number(e.key));
    return true;
  }
  if (!/^[a-zA-Z]$/.test(e.key)) return false;
  const key = e.key.toLowerCase();
  const type = ethogram(labels).find((t) => t.metadata.key === key);
  if (!type) return false;
  if (e.shiftKey && !selectedRange()) return false;
  pressBehavior(type, !e.shiftKey);
  return true;
}

