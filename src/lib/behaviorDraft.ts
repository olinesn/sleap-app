/**
 * Behavior labels saved on their own, as the crash-recovery net of a big project.
 *
 * The usual draft (`labelsDraft.ts`) rewrites the whole project. On a project of tens of
 * millions of points that holds the app for a minute or more, after every pause in
 * labelling, so behavior edits there skip it (`labelsAutosave.ts`) and come here: a small
 * record in IndexedDB, keyed by the file it belongs to. Opening that file again offers
 * it back. A real save drops it. It holds only the labels: the file holds everything else.
 */
import {
  EventType,
  Identity,
  PredictedEvent,
  Track,
  UserEvent,
  type Event,
  type EventParticipant,
  type Labels,
} from "@talmolab/sleap-io.js";
import { confirmDialog } from "@/stores/confirmStore";
import { useAppStore } from "@/stores/appStore";
import { toast } from "@/lib/notify";
import { isTauri } from "@/lib/platform";
import { isSourceChanged, type SourceSnapshot } from "@/lib/draftStaleness";

/** localStorage override of {@link DEFAULT_BIG_PROJECT_INSTANCES} (for tests). */
export const BIG_PROJECT_FLAG_KEY = "sleap.bigProjectInstances";

/** From this many instances a full draft is too slow to run after every pause. */
export const DEFAULT_BIG_PROJECT_INSTANCES = 1_000_000;

function bigProjectInstances(): number {
  try {
    const v = Number(localStorage.getItem(BIG_PROJECT_FLAG_KEY));
    if (v > 0) return v;
  } catch {
    /* no storage: the default */
  }
  return DEFAULT_BIG_PROJECT_INSTANCES;
}

/** Whether a full draft of `labels` is too slow to run after every pause in labelling. */
export function isBigProject(labels: Labels): boolean {
  const limit = bigProjectInstances();
  let n = 0;
  for (const lf of labels.labeledFrames) {
    n += lf.instances.length;
    if (n >= limit) return true;
  }
  return false;
}

/** Which file a draft belongs to: its name, size and time, or its path on desktop. */
export function behaviorDraftKey(store: {
  projectFile?: File | null;
  projectPath?: string | null;
  filename?: string | null;
}): string {
  const f = store.projectFile;
  if (f) return `${f.name}|${f.size}|${f.lastModified}`;
  return `${store.projectPath ?? store.filename ?? "project"}|`;
}

type ParticipantRow = [kind: "track" | "identity", index: number] | null;

/** The labels of a project as plain data, by position in its lists. */
export interface BehaviorDraft {
  savedAt: number;
  videoCount: number;
  /** The file these labels were edited on, on desktop, where the key is only its path. */
  source?: SourceSnapshot;
  eventTypes: Array<{
    name: string;
    description: string;
    metadata: Record<string, string>;
  }>;
  events: Array<{
    type: number;
    video: number;
    start: number;
    end: number;
    subject: ParticipantRow;
    target: ParticipantRow;
    predicted: boolean;
    name: string;
    source: string;
    metadata: Record<string, string>;
    score: number | null;
    scores: number[] | null;
  }>;
}

export function snapshotBehavior(labels: Labels, savedAt = Date.now()): BehaviorDraft {
  const typeIndex = new Map(labels.eventTypes.map((t, i) => [t, i]));
  const videoIndex = new Map(labels.videos.map((v, i) => [v, i]));
  const trackIndex = new Map(labels.tracks.map((t, i) => [t, i]));
  const identityIndex = new Map(labels.identities.map((t, i) => [t, i]));
  const row = (p: EventParticipant | null): ParticipantRow => {
    if (p instanceof Track) return ["track", trackIndex.get(p) ?? -1];
    if (p instanceof Identity) return ["identity", identityIndex.get(p) ?? -1];
    return null;
  };
  return {
    savedAt,
    videoCount: labels.videos.length,
    eventTypes: labels.eventTypes.map((t) => ({
      name: t.name,
      description: t.description,
      metadata: { ...t.metadata },
    })),
    events: labels.events.map((e) => {
      const predicted = e instanceof PredictedEvent;
      return {
        type: typeIndex.get(e.type) ?? -1,
        video: e.video ? (videoIndex.get(e.video) ?? -1) : -1,
        start: e.startFrame,
        end: e.endFrame,
        subject: row(e.subject),
        target: row(e.target),
        predicted,
        name: e.name,
        source: e.source,
        metadata: { ...e.metadata },
        score: predicted ? (e as PredictedEvent).score : null,
        scores:
          predicted && (e as PredictedEvent).scores
            ? Array.from((e as PredictedEvent).scores as Float32Array)
            : null,
      };
    }),
  };
}

/** Put a draft's labels on `labels`, replacing what it holds. False when it does not fit. */
export function applyBehaviorDraft(labels: Labels, draft: BehaviorDraft): boolean {
  if (draft.videoCount !== labels.videos.length) return false;
  const types = draft.eventTypes.map((t) => new EventType(t));
  const participant = (r: ParticipantRow): EventParticipant | null => {
    if (!r) return null;
    return (r[0] === "track" ? labels.tracks[r[1]] : labels.identities[r[1]]) ?? null;
  };
  const events: Event[] = [];
  for (const e of draft.events) {
    const type = types[e.type];
    if (!type) return false;
    const options = {
      type,
      video: labels.videos[e.video] ?? null,
      startFrame: e.start,
      endFrame: e.end,
      subject: participant(e.subject),
      target: participant(e.target),
      name: e.name,
      source: e.source,
      metadata: { ...e.metadata },
    };
    events.push(
      e.predicted
        ? new PredictedEvent({ ...options, score: e.score, scores: e.scores })
        : new UserEvent(options),
    );
  }
  labels.eventTypes = types;
  labels.events = events;
  return true;
}

const DB_NAME = "sleap-app-behavior-drafts";
const STORE = "drafts";
/** A draft nobody came back for after this long is dropped when another is saved. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** A desktop project file's size and time now. Undefined in a browser (its key holds them). */
async function projectFileSnapshot(): Promise<SourceSnapshot | undefined> {
  const path = useAppStore.getState().projectPath;
  if (!isTauri || !path) return undefined;
  try {
    const { stat } = await import("@tauri-apps/plugin-fs");
    const info = await stat(path);
    return { size: info.size, lastModified: info.mtime ? new Date(info.mtime).getTime() : undefined };
  } catch {
    return undefined;
  }
}

/** The project file as it was when opened or last saved: what a draft's labels were edited on. */
let openedFile: { key: string; snapshot: SourceSnapshot | undefined } | null = null;

export async function saveBehaviorDraft(key: string, labels: Labels): Promise<void> {
  if (openedFile?.key !== key) openedFile = { key, snapshot: await projectFileSnapshot() };
  const draft = snapshotBehavior(labels);
  draft.source = openedFile.snapshot;
  await withStore("readwrite", (store) => {
    store.put(draft, key);
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      if ((c.value as BehaviorDraft).savedAt < draft.savedAt - MAX_AGE_MS) c.delete();
      c.continue();
    };
  });
}

export async function deleteBehaviorDraft(key: string): Promise<void> {
  // A real save changes the file: the next draft goes by the file as saved.
  openedFile = null;
  try {
    await withStore("readwrite", (store) => {
      store.delete(key);
    });
  } catch {
    /* no storage: nothing to drop */
  }
}

/** What to ask before putting a draft back. A file changed since may hold labels the draft lacks. */
export function behaviorDraftPrompt(
  draft: Pick<BehaviorDraft, "savedAt" | "events" | "source">,
  file: SourceSnapshot | undefined,
): { title: string; message: string; confirmLabel: string; cancelLabel: string; destructive: boolean } {
  const n = draft.events.filter((e) => !e.predicted).length;
  const count = `${n.toLocaleString("en-US")} behavior label${n === 1 ? "" : "s"}`;
  const changed =
    !!draft.source &&
    file?.size != null &&
    file.lastModified != null &&
    isSourceChanged(draft.source, { size: file.size, lastModified: file.lastModified });
  return {
    title: "Restore unsaved behavior labels?",
    message: changed
      ? `These ${count} were edited ${new Date(draft.savedAt).toLocaleString()} and not saved, and ` +
        `this file has changed on disk since, perhaps saved by another app. ` +
        `Restoring replaces the labels the file holds now with these.`
      : `This file was last edited ${new Date(draft.savedAt).toLocaleString()} and not saved. ` +
        `Restore its ${count}?`,
    confirmLabel: "Restore",
    cancelLabel: "Discard",
    destructive: changed,
  };
}

/** If labels were left unsaved on this file, offer them back. Never blocks an open on an error. */
export async function offerBehaviorDraft(key: string, labels: Labels): Promise<void> {
  const file = await projectFileSnapshot();
  openedFile = { key, snapshot: file };
  let draft: BehaviorDraft | undefined;
  try {
    draft = await withStore<BehaviorDraft>("readonly", (store) => store.get(key));
  } catch {
    return;
  }
  if (!draft) return;
  const restore = await confirmDialog(behaviorDraftPrompt(draft, file));
  if (!restore) {
    await deleteBehaviorDraft(key);
    return;
  }
  if (applyBehaviorDraft(labels, draft)) {
    useAppStore.getState().markEventsChanged();
    toast.success("Behavior labels restored");
  } else {
    toast.warning("Could not restore the behavior labels", {
      description: "This file's videos have changed since they were saved.",
    });
  }
}
