/**
 * Behavior labels on top of sleap-io events (`labels.events` + `labels.eventTypes`,
 * SLP format 2.6). The `.slp` is how this app, LUC3D and Python sleap-io share them,
 * so everything here sticks to one vocabulary (LUC3D: `import-export/behavior-events.js`;
 * change the two together):
 *
 *   EventType            a behavior of the ethogram.
 *     name, description
 *     metadata           color ("#rrggbb"), key (one lower-case letter), group (behaviors
 *                        sharing one exclude each other for one animal), kind ("point";
 *                        a state writes nothing), directed ("true": has a target), mutual
 *                        ("true": a pair with no actor and target)
 *   not-type             an explicit "not" label is a SEPARATE type named "not <behavior>"
 *                        with metadata negates = "<behavior>", so a script counting a
 *                        behavior never counts a "not".
 *   UserEvent            a labelled bout. `subject`: the animal (an Identity, else a Track).
 *                        `target`: a social behavior's other animal. `source`: "manual",
 *                        "accepted_prediction" or "imported". metadata.note: a note.
 *   PredictedEvent       a predicted bout, reviewed by labelling it: Accept labels its
 *                        frames, Reject labels them "not". Status is read from the labels.
 *
 * Frames are 0-based and both ends are inclusive. On a multi-camera project a bout belongs
 * to the whole session: it is stored on the session's FIRST camera, and an event on ANY
 * camera of a session shows on all of them.
 *
 * Other tools' metadata keys (e.g. LUC3D's `lucid_id`) are kept untouched.
 *
 * Events and types are IMMUTABLE here: every edit builds new objects and new arrays, so
 * an undo snapshot is just the previous array references (CommandContext).
 */
import {
  EventType,
  Identity,
  PredictedEvent,
  UserEvent,
  cloneEvent,
} from "@talmolab/sleap-io.js";
import type {
  Event,
  EventParticipant,
  LabeledFrame,
  Labels,
  Track,
  Video,
} from "@talmolab/sleap-io.js";

/** Default colors for new behaviors: vivid, readable on the dark timeline and video. */
export const BEHAVIOR_COLORS = [
  "#f2a541",
  "#5fb3f9",
  "#e8749a",
  "#7fd17a",
  "#40f4f4",
  "#f4e840",
  "#f4704c",
  "#e8b8f4",
  "#a0a040",
  "#e858f4",
  "#40ac94",
  "#9488f4",
];

/** The gray a "not" label is drawn in. */
export const NOT_LABEL_COLOR = "#8a8f98";

export type BehaviorKind = "state" | "point";

/** The editable fields of a behavior. */
export interface BehaviorFields {
  name: string;
  description?: string;
  color?: string;
  key?: string;
  kind?: BehaviorKind;
  /** Has a target animal (actor -> target). */
  directed?: boolean;
  /** Implies a target; the pair has no actor and target. */
  mutual?: boolean;
  group?: string;
}

/** Is this catalog entry the "not" type of another behavior? */
export function isNotType(type: EventType): boolean {
  return !!type.metadata.negates;
}

/** The behaviors of the ethogram: the catalog without its "not" types. */
export function ethogram(labels: Labels): EventType[] {
  return labels.eventTypes.filter((t) => !isNotType(t));
}

/** The behavior's fields, read from its catalog entry. */
export function behaviorFields(type: EventType): Required<BehaviorFields> {
  const m = type.metadata;
  return {
    name: type.name,
    description: type.description,
    color: m.color ?? "",
    key: m.key ?? "",
    kind: m.kind === "point" ? "point" : "state",
    directed: m.directed === "true" || m.mutual === "true",
    mutual: m.mutual === "true",
    group: m.group ?? "",
  };
}

/** A behavior's color: its own, else one by its place in the ethogram. */
export function behaviorColor(labels: Labels, type: EventType): string {
  if (type.metadata.color) return type.metadata.color;
  const i = ethogram(labels).indexOf(type);
  return BEHAVIOR_COLORS[(i < 0 ? 0 : i) % BEHAVIOR_COLORS.length];
}

/** One lower-case letter, or "" when `key` is not one (digits pick the animal). */
export function normalizeBehaviorKey(key: string | undefined): string {
  const k = (key ?? "").trim().toLowerCase();
  return /^[a-z]$/.test(k) ? k : "";
}

/** Why these fields cannot be saved (`except`: the behavior being edited), or null. */
export function behaviorFieldProblem(
  labels: Labels,
  fields: BehaviorFields,
  except?: EventType,
): string | null {
  const name = fields.name.trim();
  if (!name) return "A behavior needs a name.";
  if (
    labels.eventTypes.some((t) => t !== except && t.name === name) &&
    !(except && notTypeOf(labels, except)?.name === name)
  ) {
    return `There is already a behavior called "${name}".`;
  }
  if (fields.key) {
    const key = normalizeBehaviorKey(fields.key);
    if (!key) return "A key is one letter.";
    const taken = ethogram(labels).find(
      (t) => t !== except && t.metadata.key === key,
    );
    if (taken) return `The "${key}" key is already "${taken.name}".`;
  }
  return null;
}

/** The catalog metadata for these fields, on top of what the entry already holds. */
function metadataFor(
  fields: BehaviorFields,
  base: Record<string, string>,
): Record<string, string> {
  const m: Record<string, string> = { ...base };
  const set = (k: string, v: string | undefined) => {
    if (v) m[k] = v;
    else delete m[k];
  };
  set("color", fields.color);
  set("key", normalizeBehaviorKey(fields.key));
  set("group", fields.group?.trim());
  set("kind", fields.kind === "point" ? "point" : "");
  set("mutual", fields.mutual ? "true" : "");
  set("directed", fields.directed && !fields.mutual ? "true" : "");
  return m;
}

/** Add a behavior to the ethogram. Check `behaviorFieldProblem` first. */
export function addBehavior(labels: Labels, fields: BehaviorFields): EventType {
  const used = new Set(ethogram(labels).map((t) => t.metadata.color));
  const color =
    fields.color ||
    BEHAVIOR_COLORS.find((c) => !used.has(c)) ||
    BEHAVIOR_COLORS[0];
  const type = new EventType({
    name: fields.name.trim(),
    description: fields.description?.trim() ?? "",
    metadata: metadataFor({ ...fields, color }, {}),
  });
  labels.eventTypes = [...labels.eventTypes, type];
  return type;
}

/** Point every event of the replaced catalog entries at their new ones. */
function rebindEvents(labels: Labels, map: Map<EventType, EventType>): void {
  labels.events = labels.events.map((e) => {
    const next = map.get(e.type);
    return next ? cloneEvent(e, { type: next }) : e;
  });
}

/**
 * Change a behavior. Its "not" type follows a rename. Making it mutual puts each of its
 * pairs in name order, the one way a mutual pair is stored.
 */
export function updateBehavior(
  labels: Labels,
  type: EventType,
  fields: BehaviorFields,
): EventType {
  const next = new EventType({
    name: fields.name.trim(),
    description: fields.description?.trim() ?? "",
    metadata: metadataFor(fields, type.metadata),
  });
  const map = new Map<EventType, EventType>([[type, next]]);
  const notType = notTypeOf(labels, type);
  if (notType) {
    map.set(
      notType,
      new EventType({
        name: notTypeName(labels, next.name, notType),
        description: notType.description,
        metadata: { ...notType.metadata, negates: next.name },
      }),
    );
  }
  labels.eventTypes = labels.eventTypes.map((t) => map.get(t) ?? t);
  rebindEvents(labels, map);
  if (next.metadata.mutual === "true") {
    labels.events = labels.events.map((e) => {
      if (e.type !== next && e.type !== map.get(notType as EventType)) return e;
      const [subject, target] = orderPair(next, e.subject, e.target);
      return subject === e.subject
        ? e
        : cloneEvent(e, { subject, target });
    });
  }
  return next;
}

/** Remove a behavior, its "not" type and all their events. */
export function removeBehavior(labels: Labels, type: EventType): void {
  const notType = notTypeOf(labels, type);
  labels.eventTypes = labels.eventTypes.filter(
    (t) => t !== type && t !== notType,
  );
  labels.events = labels.events.filter(
    (e) => e.type !== type && e.type !== notType,
  );
}

/** A behavior's "not" type, if it has one. */
export function notTypeOf(labels: Labels, type: EventType): EventType | null {
  return (
    labels.eventTypes.find((t) => t.metadata.negates === type.name) ?? null
  );
}

/** The name of a behavior's "not" type, clear of every other catalog entry's name. */
function notTypeName(
  labels: Labels,
  behaviorName: string,
  except?: EventType,
): string {
  const name = `not ${behaviorName}`;
  const taken = labels.eventTypes.some(
    (t) => t !== except && t.name === name,
  );
  return taken ? `${name} (not label)` : name;
}

/** A behavior's "not" type, added to the catalog the first time it is needed. */
function ensureNotType(labels: Labels, type: EventType): EventType {
  const existing = notTypeOf(labels, type);
  if (existing) return existing;
  const created = new EventType({
    name: notTypeName(labels, type.name),
    metadata: { negates: type.name },
  });
  labels.eventTypes = [...labels.eventTypes, created];
  return created;
}

/**
 * The videos that share events with `video`: every camera of its recording session, or
 * just itself.
 */
export function sessionVideosOf(labels: Labels, video: Video): Video[] {
  for (const session of labels.sessions) {
    const videos = session.videos;
    if (videos.includes(video)) return videos;
  }
  return [video];
}

/** Where a new bout on `video` is stored: its session's first camera, or itself. */
export function boutVideoFor(labels: Labels, video: Video): Video {
  for (const session of labels.sessions) {
    if (!session.videos.includes(video)) continue;
    for (const camera of session.cameraGroup.cameras) {
      const v = session.videoByCamera.get(camera);
      if (v) return v;
    }
    return session.videos[0];
  }
  return video;
}

/** Every event that shows on `video`. */
export function eventsForVideo(labels: Labels, video: Video): Event[] {
  const scope = new Set(sessionVideosOf(labels, video));
  return labels.events.filter((e) => e.video !== null && scope.has(e.video));
}

/**
 * The animals to label: the project's identities, else its tracks. Identities are the
 * animals on a multi-camera project, where tracks are per camera.
 */
export function behaviorAnimals(labels: Labels): EventParticipant[] {
  return labels.identities.length > 0 ? labels.identities : labels.tracks;
}

/** A participant's color key: is it an identity (vs. a track)? */
export function isIdentity(p: EventParticipant | null): p is Identity {
  return p instanceof Identity;
}

/**
 * Which animal each instance of this frame is, as {@link behaviorAnimals} names them: its
 * identity (on the instance, or through its recording session's group), else its track.
 */
export function frameAnimals(
  labels: Labels,
  video: Video,
  frame: LabeledFrame,
): Map<object, EventParticipant> {
  const out = new Map<object, EventParticipant>();
  if (labels.identities.length === 0) {
    for (const inst of frame.instances) if (inst.track) out.set(inst, inst.track);
    return out;
  }
  for (const inst of frame.instances) if (inst.identity) out.set(inst, inst.identity);
  for (const session of labels.sessions) {
    const camera = session.cameraByVideo.get(video);
    if (!camera) continue;
    for (const group of session.frameGroups.get(frame.frameIdx)?.instanceGroups ?? []) {
      const inst = group.identity && group.instanceByCamera.get(camera);
      if (inst) out.set(inst, group.identity as Identity);
    }
  }
  return out;
}

/** Put a mutual behavior's pair in name order; any other pair stays as it is. */
export function orderPair(
  type: EventType,
  subject: EventParticipant | null,
  target: EventParticipant | null,
): [EventParticipant | null, EventParticipant | null] {
  if (
    type.metadata.mutual === "true" &&
    subject &&
    target &&
    target.name < subject.name
  ) {
    return [target, subject];
  }
  return [subject, target];
}

/** A copy of `e` over another span (within its own, for a prediction's framewise scores). */
function withSpan(e: Event, startFrame: number, endFrame: number): Event {
  const c = cloneEvent(e);
  if (c instanceof PredictedEvent && c.scores) {
    c.scores = c.scores.slice(
      startFrame - e.startFrame,
      endFrame - e.startFrame + 1,
    );
  }
  c.startFrame = startFrame;
  c.endFrame = endFrame;
  return c;
}

/** Two labels that say the same thing, so touching ones merge into one. */
function sayTheSame(a: Event, b: Event): boolean {
  return (
    a.type === b.type &&
    a.video === b.video &&
    a.subject === b.subject &&
    a.target === b.target &&
    a.source === b.source &&
    (a.metadata.note ?? "") === (b.metadata.note ?? "") &&
    behaviorFields(a.type).kind !== "point"
  );
}

export interface LabelRangeOptions {
  type: EventType;
  /** The video on screen; the bout is stored per {@link boutVideoFor}. */
  video: Video;
  subject: EventParticipant | null;
  target?: EventParticipant | null;
  start: number;
  end: number;
  /** false labels the frames "not" this behavior. */
  present?: boolean;
  source?: string;
  note?: string;
}

/**
 * Label a range: present, or explicitly "not". It replaces whatever this behavior said
 * for these animals over the range, and (present, a behavior in a group) clears the
 * other behaviors of its group for the animal there. Touching labels that say the same
 * thing merge, so repeated labelling never piles up rows. A point behavior takes one frame.
 */
export function labelRange(labels: Labels, options: LabelRangeOptions): Event {
  const { type, video, present = true, source = "manual", note = "" } = options;
  const [subject, target] = orderPair(
    type,
    options.subject,
    options.target ?? null,
  );
  const lo = Math.min(options.start, options.end);
  const fields = behaviorFields(type);
  const hi = fields.kind === "point" ? lo : Math.max(options.start, options.end);
  const scope = new Set(sessionVideosOf(labels, video));
  const notType = present ? notTypeOf(labels, type) : ensureNotType(labels, type);
  const group = fields.group;

  const clears = (e: Event): boolean => {
    if (e.isPredicted || !e.video || !scope.has(e.video)) return false;
    if (e.subject !== subject) return false;
    if (e.type === type || e.type === notType) return e.target === target;
    return (
      present &&
      !!group &&
      !isNotType(e.type) &&
      e.type.metadata.group === group
    );
  };

  const kept: Event[] = [];
  for (const e of labels.events) {
    if (!clears(e) || e.endFrame < lo || e.startFrame > hi) {
      kept.push(e);
      continue;
    }
    if (e.startFrame < lo) kept.push(withSpan(e, e.startFrame, lo - 1));
    if (e.endFrame > hi) kept.push(withSpan(e, hi + 1, e.endFrame));
  }

  let bout: Event = new UserEvent({
    type: present ? type : (notType as EventType),
    video: boutVideoFor(labels, video),
    startFrame: lo,
    endFrame: hi,
    subject,
    target,
    source,
    metadata: note ? { note } : {},
  });
  const out: Event[] = [];
  for (const e of kept) {
    if (e.endFrame + 1 === bout.startFrame && sayTheSame(e, bout)) {
      bout = withSpan(bout, e.startFrame, bout.endFrame);
    } else if (bout.endFrame + 1 === e.startFrame && sayTheSame(e, bout)) {
      bout = withSpan(bout, bout.startFrame, e.endFrame);
    } else {
      out.push(e);
    }
  }
  out.push(bout);
  labels.events = out;
  return bout;
}

/**
 * Two tracks were swapped over a range of a video (a fixed identity switch): the bouts
 * follow the animals, so what was labelled on one track over those frames moves to the
 * other. Bouts that cross an end of the range split there.
 */
export function swapAnimalsInRange(
  labels: Labels,
  video: Video,
  a: EventParticipant,
  b: EventParticipant,
  start: number,
  end: number,
): void {
  const scope = new Set(sessionVideosOf(labels, video));
  const concerned = (e: Event) =>
    !!e.video &&
    scope.has(e.video) &&
    (e.subject === a || e.subject === b || e.target === a || e.target === b) &&
    e.endFrame >= start &&
    e.startFrame <= end;
  if (!labels.events.some(concerned)) return;
  const swap = (p: EventParticipant | null) =>
    p === a ? b : p === b ? a : p;
  const out: Event[] = [];
  for (const e of labels.events) {
    if (!concerned(e)) {
      out.push(e);
      continue;
    }
    if (e.startFrame < start) out.push(withSpan(e, e.startFrame, start - 1));
    if (e.endFrame > end) out.push(withSpan(e, end + 1, e.endFrame));
    const [subject, target] = orderPair(e.type, swap(e.subject), swap(e.target));
    const inner = withSpan(
      e,
      Math.max(e.startFrame, start),
      Math.min(e.endFrame, end),
    );
    inner.subject = subject;
    inner.target = target;
    out.push(inner);
  }
  labels.events = out;
}

/**
 * The events of `video` over a frame range, for a clip of it: trimmed to the range and
 * moved onto `clip` with frames counted from the clip's start. `tracks` are the clip's
 * tracks: a bout's track is matched by name. Returns the catalog entries they use.
 */
export function eventsForClip(
  labels: Labels,
  video: Video,
  start: number,
  end: number,
  clip: Video,
  shift: number,
  tracks: Track[],
): { eventTypes: EventType[]; events: Event[] } {
  const byName = new Map(tracks.map((t) => [t.name, t]));
  const onClip = (p: EventParticipant | null) =>
    (p && !isIdentity(p) && byName.get(p.name)) || p;
  const events = eventsForVideo(labels, video)
    .filter((e) => e.endFrame >= start && e.startFrame <= end)
    .map((e) => {
      const lo = Math.max(e.startFrame, start);
      const hi = Math.min(e.endFrame, end);
      const c = withSpan(e, lo, hi);
      c.video = clip;
      c.subject = onClip(e.subject);
      c.target = onClip(e.target);
      c.startFrame = lo - shift;
      c.endFrame = hi - shift;
      return c;
    });
  const used = new Set(events.map((e) => e.type));
  return {
    eventTypes: labels.eventTypes.filter((t) => used.has(t)),
    events,
  };
}

/** Remove one bout. */
export function deleteBout(labels: Labels, bout: Event): void {
  labels.events = labels.events.filter((e) => e !== bout);
}

/** What a bout can be edited to. */
export interface BoutChanges {
  startFrame?: number;
  endFrame?: number;
  subject?: EventParticipant | null;
  target?: EventParticipant | null;
  note?: string;
}

/** Change a bout. Returns the new one, or null when the span would be impossible. */
export function editBout(
  labels: Labels,
  bout: Event,
  changes: BoutChanges,
): Event | null {
  const start = changes.startFrame ?? bout.startFrame;
  const end = changes.endFrame ?? bout.endFrame;
  if (!(start >= 0) || !(end >= start)) return null;
  const [subject, target] = orderPair(
    bout.type,
    changes.subject !== undefined ? changes.subject : bout.subject,
    changes.target !== undefined ? changes.target : bout.target,
  );
  const next = withSpan(cloneEvent(bout, { subject, target }), start, end);
  if (changes.note !== undefined) {
    if (changes.note) next.metadata.note = changes.note;
    else delete next.metadata.note;
  }
  labels.events = labels.events.map((e) => (e === bout ? next : e));
  return next;
}

/** A prediction's review, read from the labels over its frames. */
export type ReviewStatus = "open" | "accepted" | "rejected" | "mixed";

export function predictionStatus(
  labels: Labels,
  prediction: Event,
): ReviewStatus {
  const notType = notTypeOf(labels, prediction.type);
  const scope = prediction.video
    ? new Set(sessionVideosOf(labels, prediction.video))
    : null;
  let yes = false;
  let no = false;
  for (const e of labels.events) {
    if (
      e.isPredicted ||
      (scope && (!e.video || !scope.has(e.video))) ||
      e.subject !== prediction.subject ||
      e.target !== prediction.target ||
      e.endFrame < prediction.startFrame ||
      e.startFrame > prediction.endFrame
    ) {
      continue;
    }
    if (e.type === prediction.type) yes = true;
    else if (notType && e.type === notType) no = true;
  }
  if (yes && no) return "mixed";
  return yes ? "accepted" : no ? "rejected" : "open";
}

/** One kind of label of one pair of animals, sorted by start, to ask "any overlap?" fast. */
interface LabelSpans {
  starts: number[];
  /** The latest end among the spans up to here. */
  latestEnd: number[];
}

function anyOverlap(spans: LabelSpans | undefined, start: number, end: number): boolean {
  if (!spans) return false;
  // The last span starting at or before `end`: whichever ends latest up to it decides.
  let lo = 0;
  let hi = spans.starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans.starts[mid] <= end) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && spans.latestEnd[lo - 1] >= start;
}

/**
 * {@link predictionStatus} of many predictions at once. The panel asks for every
 * prediction on every edit: thousands of predictions over thousands of labels is too many
 * scans to keep a label edit quick.
 */
export function predictionStatuses(
  labels: Labels,
  predictions: Event[],
): Map<Event, ReviewStatus> {
  // A session's videos share labels, so a label's scope is its session, else its video.
  const scopeOf = new Map<Video, object>();
  for (const session of labels.sessions) {
    for (const v of session.videos) scopeOf.set(v, session);
  }
  const ids = new Map<object, number>();
  const idOf = (o: object | null): number => {
    if (!o) return -1;
    let id = ids.get(o);
    if (id === undefined) {
      id = ids.size;
      ids.set(o, id);
    }
    return id;
  };
  const scopeId = (v: Video | null): number =>
    v ? idOf(scopeOf.get(v) ?? v) : -1;
  const keyOf = (
    type: EventType,
    video: Video | null,
    subject: EventParticipant | null,
    target: EventParticipant | null,
  ) => `${idOf(type)}:${scopeId(video)}:${idOf(subject)}:${idOf(target)}`;

  const grouped = new Map<string, Event[]>();
  for (const e of labels.events) {
    if (e.isPredicted) continue;
    const key = keyOf(e.type, e.video, e.subject, e.target);
    const list = grouped.get(key);
    if (list) list.push(e);
    else grouped.set(key, [e]);
  }
  const spans = new Map<string, LabelSpans>();
  for (const [key, list] of grouped) {
    list.sort((a, b) => a.startFrame - b.startFrame);
    let latest = -Infinity;
    spans.set(key, {
      starts: list.map((e) => e.startFrame),
      latestEnd: list.map((e) => (latest = Math.max(latest, e.endFrame))),
    });
  }

  const notTypes = new Map<string, EventType>();
  for (const t of labels.eventTypes) {
    if (t.metadata.negates && !notTypes.has(t.metadata.negates)) {
      notTypes.set(t.metadata.negates, t);
    }
  }
  const out = new Map<Event, ReviewStatus>();
  for (const p of predictions) {
    const notType = notTypes.get(p.type.name);
    const yes = anyOverlap(
      spans.get(keyOf(p.type, p.video, p.subject, p.target)),
      p.startFrame,
      p.endFrame,
    );
    const no =
      !!notType &&
      anyOverlap(
        spans.get(keyOf(notType, p.video, p.subject, p.target)),
        p.startFrame,
        p.endFrame,
      );
    out.set(p, yes && no ? "mixed" : yes ? "accepted" : no ? "rejected" : "open");
  }
  return out;
}

/** Accept: label the prediction's frames present. */
export function acceptPrediction(labels: Labels, prediction: Event): Event {
  return labelRange(labels, {
    type: prediction.type,
    video: prediction.video as Video,
    subject: prediction.subject,
    target: prediction.target,
    start: prediction.startFrame,
    end: prediction.endFrame,
    present: true,
    source: "accepted_prediction",
  });
}

/** Reject: label the prediction's frames "not". */
export function rejectPrediction(labels: Labels, prediction: Event): Event {
  return labelRange(labels, {
    type: prediction.type,
    video: prediction.video as Video,
    subject: prediction.subject,
    target: prediction.target,
    start: prediction.startFrame,
    end: prediction.endFrame,
    present: false,
  });
}

/** The behavior a label belongs to: itself, or what its "not" type negates. */
export function behaviorOfEvent(labels: Labels, e: Event): EventType | null {
  if (!isNotType(e.type)) return e.type;
  return (
    labels.eventTypes.find((t) => t.name === e.type.metadata.negates) ?? null
  );
}

/** The labels and predictions covering one frame of `video`. */
export function eventsAtFrame(
  labels: Labels,
  video: Video,
  frameIdx: number,
): Event[] {
  return eventsForVideo(labels, video).filter((e) => e.contains(frameIdx));
}

/** How a bout reads: "mouse1", "mouse1 -> mouse2", "mouse1 <-> mouse2", or "". */
export function boutWho(bout: Event): string {
  if (!bout.subject) return "";
  if (!bout.target) return bout.subject.name;
  const arrow = bout.type.metadata.mutual === "true" ? "<->" : "->";
  return `${bout.subject.name} ${arrow} ${bout.target.name}`;
}

/** One row of the timeline: one behavior of one animal, on the video on screen. */
export interface BehaviorLane {
  key: string;
  type: EventType;
  subject: EventParticipant | null;
  color: string;
  label: string;
  bouts: Event[];
}

/** The timeline's rows, ethogram order then animal order. A "not" lies on its behavior's row. */
export function behaviorLanes(labels: Labels, video: Video): BehaviorLane[] {
  const lanes = new Map<string, BehaviorLane>();
  const animals = behaviorAnimals(labels);
  const types = ethogram(labels);
  const subjectIds = new Map<EventParticipant, number>();
  const idOf = (p: EventParticipant | null): number => {
    if (!p) return -1;
    let id = subjectIds.get(p);
    if (id === undefined) {
      id = subjectIds.size;
      subjectIds.set(p, id);
    }
    return id;
  };
  for (const e of eventsForVideo(labels, video)) {
    const type = behaviorOfEvent(labels, e);
    if (!type) continue;
    const key = `${types.indexOf(type)}:${idOf(e.subject)}`;
    let lane = lanes.get(key);
    if (!lane) {
      lane = {
        key,
        type,
        subject: e.subject,
        color: behaviorColor(labels, type),
        label: e.subject ? `${type.name} · ${e.subject.name}` : type.name,
        bouts: [],
      };
      lanes.set(key, lane);
    }
    lane.bouts.push(e);
  }
  const rank = (p: EventParticipant | null) => {
    const i = p ? animals.indexOf(p as Track & Identity) : -1;
    return i < 0 ? animals.length : i;
  };
  return [...lanes.values()].sort(
    (a, b) =>
      types.indexOf(a.type) - types.indexOf(b.type) ||
      rank(a.subject) - rank(b.subject),
  );
}

/** A prediction's event type check, for the panel. */
export function isPrediction(e: Event): e is PredictedEvent {
  return e instanceof PredictedEvent;
}
