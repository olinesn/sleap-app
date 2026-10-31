/**
 * Frame-delta journal codec for the incremental autosave (Phase 2a).
 *
 * Between full "base" snapshots, each autosave tick appends the frames dirtied
 * since the previous tick to an append-only journal — a tiny write instead of
 * re-serializing the whole project (the fix for the multi-second autosave
 * freeze on large projects). This module encodes/decodes those per-frame
 * records and replays them onto a loaded base at recovery time.
 *
 * Fidelity: a delta captures ONE frame's imageless annotation state at exactly
 * the fidelity the app's own undo system preserves (mirrors CommandContext's
 * `cloneInstances`: skeleton, points {xy, visible, complete, name, score},
 * track, predicted + score, isNegative). A recovered edited frame therefore
 * matches what an undo would have produced. Instances reference the base's
 * videos/tracks/skeletons BY INDEX — valid because any structural change (new/
 * removed/renamed track, skeleton edit, new video, merge) rewrites the base and
 * truncates the journal, so a live journal never outlives the indices it uses.
 *
 * On-disk framing is WAL-style: each record is `[u32 len][u32 crc32][payload]`
 * (big-endian, JSON payload). A crash mid-append leaves a torn or corrupt final
 * record; {@link decodeJournal} detects it (length overrun or CRC mismatch) and
 * drops the tail rather than corrupting recovery.
 */
import {
  Embedding,
  type Identity,
  Instance,
  PredictedInstance,
  LabeledFrame,
  type Labels,
  type Video,
  type Track,
  type Skeleton,
} from "@talmolab/sleap-io.js";

/** One keypoint's state (short keys keep the journal compact). */
export interface PointDelta {
  /** Node name (from the skeleton); null if unnamed. */
  n: string | null;
  /** NaN for a missing node, which JSON stores as null. */
  x: number;
  y: number;
  /** Visible. */
  v: boolean;
  /** Complete. */
  c: boolean;
  /** Point score; null if unscored. */
  s: number | null;
}

/** One instance's state, referencing base track/skeleton by index. */
export interface InstanceDelta {
  /** Index into base.tracks, or -1 if untracked. */
  t: number;
  /** Index into base.skeletons. */
  k: number;
  /** Predicted instance? */
  p: boolean;
  /** Instance-level score (predicted only); null otherwise. */
  s: number | null;
  pts: PointDelta[];
  /** Tracker's score. This and the rest are left out when the instance has none. */
  ts?: number;
  /** Index into base.identities, with its score and embedding. */
  id?: number;
  is?: number | null;
  ie?: number[];
  /** Category, with its score and embedding. */
  cat?: string;
  cs?: number | null;
  ce?: number[];
  /** Index in this frame of the prediction this instance was accepted from. */
  fp?: number;
}

/** One frame's full imageless state. */
export interface FrameDelta {
  /** Index into base.videos. */
  v: number;
  /** Frame index within the video. */
  f: number;
  /** isNegative flag. */
  neg: boolean;
  ins: InstanceDelta[];
}

/** Reverse lookups from base entities to their array indices (built per tick). */
export interface BaseIndex {
  videos: Map<Video, number>;
  tracks: Map<Track, number>;
  skeletons: Map<Skeleton, number>;
  identities: Map<Identity, number>;
}

/** Build the base→index maps once per autosave tick (O(videos+tracks+skeletons)). */
export function buildBaseIndex(labels: Labels): BaseIndex {
  const videos = new Map<Video, number>();
  labels.videos.forEach((v, i) => videos.set(v, i));
  const tracks = new Map<Track, number>();
  labels.tracks.forEach((t, i) => tracks.set(t, i));
  const skeletons = new Map<Skeleton, number>();
  labels.skeletons.forEach((s, i) => skeletons.set(s, i));
  const identities = new Map<Identity, number>();
  labels.identities.forEach((id, i) => identities.set(id, i));
  return { videos, tracks, skeletons, identities };
}

/** Encode one labeled frame to a delta, referencing base entities by index. */
export function encodeFrameDelta(frame: LabeledFrame, index: BaseIndex): FrameDelta {
  return {
    v: index.videos.get(frame.video) ?? -1,
    f: frame.frameIdx,
    neg: frame.isNegative,
    ins: frame.instances.map((inst) => {
      const encoded = encodeInstance(inst, index);
      const accepted = inst.fromPredicted
        ? frame.instances.indexOf(inst.fromPredicted)
        : -1;
      if (accepted >= 0) encoded.fp = accepted;
      return encoded;
    }),
  };
}

function encodeInstance(inst: Instance, index: BaseIndex): InstanceDelta {
  const predicted = inst instanceof PredictedInstance;
  return {
    t: inst.track ? index.tracks.get(inst.track) ?? -1 : -1,
    k: index.skeletons.get(inst.skeleton) ?? -1,
    p: predicted,
    s: predicted ? (inst as PredictedInstance).score ?? null : null,
    pts: inst.points.map((pt) => ({
      n: pt.name ?? null,
      x: pt.xy[0],
      y: pt.xy[1],
      v: pt.visible,
      c: pt.complete,
      s: pt.score ?? null,
    })),
    ...encodeLabels(inst, index),
  };
}

/** What the instance carries besides its pose and track; absent keys when it has none. */
function encodeLabels(inst: Instance, index: BaseIndex): Partial<InstanceDelta> {
  const out: Partial<InstanceDelta> = {};
  if (inst.trackingScore) out.ts = inst.trackingScore;
  if (inst.identity) {
    out.id = index.identities.get(inst.identity) ?? -1;
    out.is = inst.identityScore ?? null;
  }
  if (inst.identityEmbedding) out.ie = inst.identityEmbedding.vector;
  if (inst.category) {
    out.cat = inst.category;
    out.cs = inst.categoryScore ?? null;
  }
  if (inst.categoryEmbedding) out.ce = inst.categoryEmbedding.vector;
  return out;
}

function restoreLabels(inst: Instance, ins: InstanceDelta, base: Labels): Instance {
  if (ins.ts) inst.trackingScore = ins.ts;
  const identity = ins.id != null ? base.identities[ins.id] : undefined;
  if (identity) {
    inst.identity = identity;
    inst.identityScore = ins.is ?? null;
  }
  if (ins.ie) inst.identityEmbedding = new Embedding(ins.ie);
  if (ins.cat) {
    inst.category = ins.cat;
    inst.categoryScore = ins.cs ?? null;
  }
  if (ins.ce) inst.categoryEmbedding = new Embedding(ins.ce);
  return inst;
}

// --- On-disk record framing --------------------------------------------------

/** Frame one delta as `[u32 len][u32 crc32][JSON payload]` (big-endian). */
export function frameDeltaToRecord(delta: FrameDelta): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(delta));
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length, false);
  view.setUint32(4, crc32(payload), false);
  out.set(payload, 8);
  return out;
}

/**
 * Decode all intact records from a journal byte buffer. A torn tail (a record
 * whose declared length overruns the buffer) or a corrupt record (CRC mismatch
 * / unparseable payload) stops decoding and sets `truncatedTail` — earlier
 * records are still returned, so a crash mid-append loses only the last write.
 */
export function decodeJournal(bytes: Uint8Array): {
  deltas: FrameDelta[];
  truncatedTail: boolean;
} {
  const deltas: FrameDelta[] = [];
  if (bytes.length === 0) return { deltas, truncatedTail: false };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos, false);
    const crc = view.getUint32(pos + 4, false);
    const start = pos + 8;
    const end = start + len;
    if (end > bytes.length) return { deltas, truncatedTail: true };
    const payload = bytes.subarray(start, end);
    if (crc32(payload) !== crc) return { deltas, truncatedTail: true };
    try {
      deltas.push(JSON.parse(new TextDecoder().decode(payload)) as FrameDelta);
    } catch {
      return { deltas, truncatedTail: true };
    }
    pos = end;
  }
  // A trailing partial header (fewer than 8 bytes left) is also a torn write.
  return { deltas, truncatedTail: pos !== bytes.length };
}

// --- Replay ------------------------------------------------------------------

/**
 * Apply journal deltas onto a loaded base `Labels`, in order (last write per
 * (video, frameIdx) wins). Existing frames have their instances replaced;
 * frames absent from the base are created. Instances are rebuilt against the
 * base's own track/skeleton objects (by index) so identity is preserved.
 * Defensive: a delta referencing an out-of-range video/skeleton is skipped
 * rather than throwing (recovery must never crash on a bad record).
 */
export function applyDeltas(base: Labels, deltas: FrameDelta[]): void {
  if (deltas.length === 0) return;

  // Index existing frames by (video, frameIdx) for O(1) find-or-create — never
  // `base.find({video})` per delta (the sleap-io.js O(project) slow path).
  const byVideo = new Map<Video, Map<number, LabeledFrame>>();
  for (const lf of base.labeledFrames) {
    let m = byVideo.get(lf.video);
    if (!m) {
      m = new Map();
      byVideo.set(lf.video, m);
    }
    m.set(lf.frameIdx, lf);
  }

  for (const delta of deltas) {
    const video = base.videos[delta.v];
    if (!video) continue; // unknown/out-of-range video — skip defensively
    let m = byVideo.get(video);
    if (!m) {
      m = new Map();
      byVideo.set(video, m);
    }
    let lf = m.get(delta.f);
    if (!lf) {
      lf = new LabeledFrame({ video, frameIdx: delta.f });
      base.labeledFrames.push(lf);
      m.set(delta.f, lf);
    }
    const rebuilt = delta.ins.map((ins) => rebuildInstance(ins, base));
    delta.ins.forEach((ins, i) => {
      const accepted = ins.fp != null ? rebuilt[ins.fp] : null;
      if (rebuilt[i] && accepted instanceof PredictedInstance) {
        (rebuilt[i] as Instance).fromPredicted = accepted;
      }
    });
    lf.instances = rebuilt.filter((inst): inst is Instance => inst !== null);
    lf.isNegative = delta.neg;
  }

  // We mutated `labeledFrames`/`instances` directly, so io's count-guarded
  // indices are stale — rebuild once (as CommandContext.restoreSnapshot does).
  base.reindex();
}

function rebuildInstance(ins: InstanceDelta, base: Labels): Instance | null {
  const skeleton = base.skeletons[ins.k];
  if (!skeleton) return null; // can't rebuild without a skeleton
  const track = ins.t >= 0 ? base.tracks[ins.t] ?? null : null;
  if (ins.p) {
    return restoreLabels(
      new PredictedInstance({
        skeleton,
        points: ins.pts.map((p) => ({
          xy: [p.x ?? NaN, p.y ?? NaN] as [number, number],
          visible: p.v,
          complete: p.c,
          name: p.n ?? undefined,
          score: p.s ?? 0,
        })),
        track,
        score: ins.s ?? 0,
      }),
      ins,
      base,
    );
  }
  return restoreLabels(
    new Instance({
      skeleton,
      points: ins.pts.map((p) => ({
        xy: [p.x ?? NaN, p.y ?? NaN] as [number, number],
        visible: p.v,
        complete: p.c,
        name: p.n ?? undefined,
        score: p.s ?? undefined,
      })),
      track,
    }),
    ins,
    base,
  );
}

// --- CRC32 (standard IEEE polynomial 0xEDB88320) -----------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
