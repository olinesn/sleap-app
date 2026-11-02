/**
 * Behavior labels on sleap-io events (`src/lib/behaviorEvents.ts`). The vocabulary here
 * is shared with LUC3D and Python sleap-io, so it is pinned: the metadata keys, the "not"
 * types, a mutual pair in name order, inclusive spans, and one bout per session.
 */
import { describe, it, expect } from "../bun-test";
import {
  Camera,
  CameraGroup,
  type Event,
  EventType,
  FrameGroup,
  Identity,
  Instance,
  InstanceGroup,
  LabeledFrame,
  Labels,
  Skeleton,
  PredictedEvent,
  RecordingSession,
  Track,
  UserEvent,
  Video,
  loadSlp,
  saveSlpToBytes,
} from "@talmolab/sleap-io.js";
import {
  acceptPrediction,
  addBehavior,
  eventsForClip,
  swapAnimalsInRange,
  behaviorAnimals,
  behaviorFieldProblem,
  behaviorFields,
  behaviorLanes,
  behaviorOfEvent,
  boutVideoFor,
  boutWho,
  deleteBout,
  editBout,
  ethogram,
  eventsAtFrame,
  eventsForVideo,
  frameAnimals,
  isNotType,
  labelRange,
  notTypeOf,
  normalizeBehaviorKey,
  orderPair,
  predictionStatus,
  predictionStatuses,
  rejectPrediction,
  removeBehavior,
  sessionVideosOf,
  updateBehavior,
} from "@/lib/behaviorEvents";

function project() {
  const video = new Video({ filename: "v.mp4" });
  const a = new Track("a");
  const b = new Track("b");
  const labels = new Labels({ videos: [video], tracks: [a, b] });
  return { labels, video, a, b };
}

/** Two cameras of one session, plus a video of no session. */
function sessionProject() {
  const v0 = new Video({ filename: "cam0.mp4" });
  const v1 = new Video({ filename: "cam1.mp4" });
  const lone = new Video({ filename: "lone.mp4" });
  const c0 = new Camera({ name: "cam0", rvec: [0, 0, 0], tvec: [0, 0, 0] });
  const c1 = new Camera({ name: "cam1", rvec: [0, 0, 0], tvec: [1, 0, 0] });
  const session = new RecordingSession({ cameraGroup: new CameraGroup({ cameras: [c0, c1] }) });
  session.addVideo(v1, c1); // Map order differs from camera order on purpose.
  session.addVideo(v0, c0);
  const mouse = new Identity({ name: "mouse" });
  const labels = new Labels({ videos: [v0, v1, lone], sessions: [session], identities: [mouse] });
  return { labels, v0, v1, lone, mouse };
}

const rows = (labels: Labels) =>
  labels.events
    .map((e) => [e.type.name, e.startFrame, e.endFrame, e.subject?.name ?? "", e.target?.name ?? ""])
    .sort((x, y) => (x[1] as number) - (y[1] as number));

describe("the ethogram", () => {
  it("writes only what differs from the defaults, in the shared keys", () => {
    const { labels } = project();
    const rear = addBehavior(labels, { name: " rear ", key: "R", description: "up" });
    expect(rear.name).toBe("rear");
    expect(rear.description).toBe("up");
    expect(rear.metadata.key).toBe("r");
    expect(rear.metadata.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(Object.keys(rear.metadata).sort()).toEqual(["color", "key"]);
    const chase = addBehavior(labels, { name: "chase", directed: true, kind: "point", group: "g" });
    expect(chase.metadata.directed).toBe("true");
    expect(chase.metadata.kind).toBe("point");
    expect(chase.metadata.group).toBe("g");
    const sniff = addBehavior(labels, { name: "sniff", directed: true, mutual: true });
    expect(sniff.metadata.mutual).toBe("true");
    expect(sniff.metadata.directed).toBeUndefined();
    expect(behaviorFields(sniff).directed).toBe(true);
    expect(rear.metadata.color).not.toBe(chase.metadata.color);
  });

  it("refuses a duplicate name or key, and a key that is not a letter", () => {
    const { labels } = project();
    const rear = addBehavior(labels, { name: "rear", key: "r" });
    expect(behaviorFieldProblem(labels, { name: "" })).toMatch(/name/);
    expect(behaviorFieldProblem(labels, { name: "rear" })).toMatch(/already/);
    expect(behaviorFieldProblem(labels, { name: "up", key: "r" })).toMatch(/key/);
    expect(behaviorFieldProblem(labels, { name: "up", key: "1" })).toMatch(/letter/);
    expect(behaviorFieldProblem(labels, { name: "rear", key: "r" }, rear)).toBeNull();
    expect(normalizeBehaviorKey("Q")).toBe("q");
    expect(normalizeBehaviorKey("7")).toBe("");
  });

  it("keeps other tools' metadata through an edit; a rename carries its events and \"not\" type", () => {
    const { labels, video, a } = project();
    const rear = addBehavior(labels, { name: "rear" });
    rear.metadata.lucid_id = "b3";
    labelRange(labels, { type: rear, video, subject: a, start: 0, end: 5 });
    labelRange(labels, { type: rear, video, subject: a, start: 10, end: 15, present: false });
    const renamed = updateBehavior(labels, rear, { name: "rearing", color: "#123456" });
    expect(renamed.metadata.lucid_id).toBe("b3");
    expect(renamed.metadata.color).toBe("#123456");
    expect(labels.eventTypes.map((t) => t.name)).toEqual(["rearing", "not rearing"]);
    const not = notTypeOf(labels, renamed);
    expect(not?.metadata.negates).toBe("rearing");
    expect(labels.events.filter((e) => e.type === renamed)).toHaveLength(1);
    expect(labels.events.filter((e) => e.type === not)).toHaveLength(1);
    expect(labels.events.every((e) => labels.eventTypes.includes(e.type))).toBe(true);
  });

  it("removing a behavior removes its \"not\" type and every event of both", () => {
    const { labels, video, a } = project();
    const rear = addBehavior(labels, { name: "rear" });
    const groom = addBehavior(labels, { name: "groom" });
    labelRange(labels, { type: rear, video, subject: a, start: 0, end: 5 });
    labelRange(labels, { type: rear, video, subject: a, start: 10, end: 15, present: false });
    labelRange(labels, { type: groom, video, subject: a, start: 20, end: 25 });
    removeBehavior(labels, rear);
    expect(labels.eventTypes).toEqual([groom]);
    expect(rows(labels)).toEqual([["groom", 20, 25, "a", ""]]);
  });

  it("making a behavior mutual orders its pairs by name", () => {
    const { labels, video, a, b } = project();
    const chase = addBehavior(labels, { name: "chase", directed: true });
    labelRange(labels, { type: chase, video, subject: b, target: a, start: 0, end: 5 });
    const next = updateBehavior(labels, chase, { name: "chase", directed: true, mutual: true });
    expect(labels.events[0].type).toBe(next);
    expect(labels.events[0].subject).toBe(a);
    expect(labels.events[0].target).toBe(b);
  });
});

describe("labelling a range", () => {
  it("is inclusive at both ends", () => {
    const { labels, video, a } = project();
    const rear = addBehavior(labels, { name: "rear" });
    const bout = labelRange(labels, { type: rear, video, subject: a, start: 5, end: 9 });
    expect(bout.startFrame).toBe(5);
    expect(bout.endFrame).toBe(9);
    expect(bout.nFrames).toBe(5);
    expect(bout.source).toBe("manual");
    expect(eventsAtFrame(labels, video, 9)).toHaveLength(1);
    expect(eventsAtFrame(labels, video, 10)).toHaveLength(0);
  });

  it("accepts the ends in either order, and a point takes one frame", () => {
    const { labels, video, a } = project();
    const rear = addBehavior(labels, { name: "rear" });
    expect(labelRange(labels, { type: rear, video, subject: a, start: 9, end: 5 }).startFrame).toBe(5);
    const bite = addBehavior(labels, { name: "bite", kind: "point" });
    const b = labelRange(labels, { type: bite, video, subject: a, start: 20, end: 30 });
    expect([b.startFrame, b.endFrame]).toEqual([20, 20]);
  });

  it("merges touching labels that say the same, and never edits an old object", () => {
    const { labels, video, a } = project();
    const rear = addBehavior(labels, { name: "rear" });
    labelRange(labels, { type: rear, video, subject: a, start: 0, end: 4 });
    const before = labels.events;
    const first = before[0];
    labelRange(labels, { type: rear, video, subject: a, start: 5, end: 9 });
    labelRange(labels, { type: rear, video, subject: a, start: 10, end: 14 });
    expect(rows(labels)).toEqual([["rear", 0, 14, "a", ""]]);
    expect(before).not.toBe(labels.events);
    expect([first.startFrame, first.endFrame]).toEqual([0, 4]);
  });

  it("keeps touching labels apart when they differ, and two point events always", () => {
    const { labels, video, a } = project();
    const rear = addBehavior(labels, { name: "rear" });
    labelRange(labels, { type: rear, video, subject: a, start: 0, end: 4, note: "one" });
    labelRange(labels, { type: rear, video, subject: a, start: 5, end: 9, note: "two" });
    expect(labels.events).toHaveLength(2);
    const bite = addBehavior(labels, { name: "bite", kind: "point" });
    labelRange(labels, { type: bite, video, subject: a, start: 20, end: 20 });
    labelRange(labels, { type: bite, video, subject: a, start: 21, end: 21 });
    expect(labels.events.filter((e) => e.type === bite)).toHaveLength(2);
  });

  it("a \"not\" label is its own type and carves the behavior out", () => {
    const { labels, video, a } = project();
    const rear = addBehavior(labels, { name: "rear" });
    labelRange(labels, { type: rear, video, subject: a, start: 0, end: 20 });
    labelRange(labels, { type: rear, video, subject: a, start: 5, end: 9, present: false });
    expect(rows(labels)).toEqual([
      ["rear", 0, 4, "a", ""],
      ["not rear", 5, 9, "a", ""],
      ["rear", 10, 20, "a", ""],
    ]);
    const not = notTypeOf(labels, rear) as EventType;
    expect(isNotType(not)).toBe(true);
    expect(not.metadata.negates).toBe("rear");
    expect(ethogram(labels)).toEqual([rear]);
    // Counting the behavior, as a script would, never counts the "not".
    expect(labels.getEvents({ type: "rear" })).toHaveLength(2);
    expect(behaviorOfEvent(labels, labels.getEvents({ type: "not rear" })[0])).toBe(rear);
    // A present label takes the frames back.
    labelRange(labels, { type: rear, video, subject: a, start: 5, end: 9 });
    expect(rows(labels)).toEqual([["rear", 0, 20, "a", ""]]);
  });

  it("does not touch another animal, or another target", () => {
    const { labels, video, a, b } = project();
    const rear = addBehavior(labels, { name: "rear" });
    labelRange(labels, { type: rear, video, subject: a, start: 0, end: 9 });
    labelRange(labels, { type: rear, video, subject: b, start: 0, end: 9 });
    expect(labels.events).toHaveLength(2);
    const c = new Track("c");
    const chase = addBehavior(labels, { name: "chase", directed: true });
    labelRange(labels, { type: chase, video, subject: a, target: b, start: 20, end: 29 });
    labelRange(labels, { type: chase, video, subject: a, target: c, start: 20, end: 29 });
    expect(labels.events.filter((e) => e.type === chase)).toHaveLength(2);
    expect(boutWho(labels.events[3])).toBe("a -> c");
  });

  it("a group excludes its other behaviors for that animal, over that range", () => {
    const { labels, video, a, b } = project();
    const sit = addBehavior(labels, { name: "sit", group: "posture" });
    const stand = addBehavior(labels, { name: "stand", group: "posture" });
    labelRange(labels, { type: sit, video, subject: a, start: 0, end: 20 });
    labelRange(labels, { type: sit, video, subject: b, start: 0, end: 20 });
    labelRange(labels, { type: stand, video, subject: a, start: 5, end: 9 });
    expect(rows(labels).filter((r) => r[3] === "a")).toEqual([
      ["sit", 0, 4, "a", ""],
      ["stand", 5, 9, "a", ""],
      ["sit", 10, 20, "a", ""],
    ]);
    expect(rows(labels).filter((r) => r[3] === "b")).toEqual([["sit", 0, 20, "b", ""]]);
  });

  it("a mutual pair is stored once, in name order", () => {
    const { labels, video, a, b } = project();
    const sniff = addBehavior(labels, { name: "sniff", directed: true, mutual: true });
    labelRange(labels, { type: sniff, video, subject: b, target: a, start: 0, end: 4 });
    labelRange(labels, { type: sniff, video, subject: a, target: b, start: 5, end: 9 });
    expect(rows(labels)).toEqual([["sniff", 0, 9, "a", "b"]]);
    expect(boutWho(labels.events[0])).toBe("a <-> b");
    expect(orderPair(sniff, b, a)).toEqual([a, b]);
    const chase = addBehavior(labels, { name: "chase", directed: true });
    expect(orderPair(chase, b, a)).toEqual([b, a]);
  });
});

describe("editing a bout", () => {
  it("edits and deletes; an impossible span changes nothing", () => {
    const { labels, video, a, b } = project();
    const rear = addBehavior(labels, { name: "rear" });
    const bout = labelRange(labels, { type: rear, video, subject: a, start: 5, end: 9, note: "x" });
    expect(editBout(labels, bout, { endFrame: 2 })).toBeNull();
    expect(labels.events).toEqual([bout]);
    const next = editBout(labels, bout, { startFrame: 6, subject: b, note: "" });
    expect(next?.startFrame).toBe(6);
    expect(next?.endFrame).toBe(9);
    expect(next?.subject).toBe(b);
    expect(next?.metadata.note).toBeUndefined();
    expect(bout.startFrame).toBe(5);
    deleteBout(labels, next as UserEvent);
    expect(labels.events).toHaveLength(0);
  });
});

describe("sessions", () => {
  it("a bout is stored on the first camera, and shows on every camera of the session", () => {
    const { labels, v0, v1, lone, mouse } = sessionProject();
    expect(sessionVideosOf(labels, v1)).toContain(v0);
    expect(sessionVideosOf(labels, lone)).toEqual([lone]);
    expect(boutVideoFor(labels, v1)).toBe(v0);
    const rear = addBehavior(labels, { name: "rear" });
    const bout = labelRange(labels, { type: rear, video: v1, subject: mouse, start: 0, end: 4 });
    expect(bout.video).toBe(v0);
    expect(eventsForVideo(labels, v0)).toHaveLength(1);
    expect(eventsForVideo(labels, v1)).toHaveLength(1);
    expect(eventsForVideo(labels, lone)).toHaveLength(0);
  });

  it("an event another tool put on any camera shows on all of them", () => {
    const { labels, v0, v1, mouse } = sessionProject();
    labels.events.push(new UserEvent({ type: "rear", video: v1, startFrame: 3, subject: mouse }));
    labels._collectEvents();
    expect(eventsForVideo(labels, v0)).toHaveLength(1);
    // Labelling on the other camera replaces it, rather than stacking a second.
    const rear = labels.eventTypes[0];
    labelRange(labels, { type: rear, video: v0, subject: mouse, start: 0, end: 9 });
    expect(rows(labels)).toEqual([["rear", 0, 9, "mouse", ""]]);
  });

  it("animals are the identities when there are any, else the tracks", () => {
    expect(behaviorAnimals(sessionProject().labels).map((a) => a.name)).toEqual(["mouse"]);
    expect(behaviorAnimals(project().labels).map((a) => a.name)).toEqual(["a", "b"]);
  });
});

describe("reviewing predictions", () => {
  function withPrediction() {
    const { labels, video, a } = project();
    const rear = addBehavior(labels, { name: "rear" });
    const pred = new PredictedEvent({
      type: rear,
      video,
      startFrame: 10,
      endFrame: 19,
      subject: a,
      score: 0.8,
      source: "rule",
    });
    labels.events = [pred];
    return { labels, video, a, rear, pred };
  }

  it("Accept labels its frames, and leaves the prediction", () => {
    const { labels, pred } = withPrediction();
    expect(predictionStatus(labels, pred)).toBe("open");
    const label = acceptPrediction(labels, pred);
    expect(label.source).toBe("accepted_prediction");
    expect(label.isPredicted).toBe(false);
    expect(predictionStatus(labels, pred)).toBe("accepted");
    expect(labels.events).toContain(pred);
  });

  it("Reject labels them \"not\"", () => {
    const { labels, pred } = withPrediction();
    rejectPrediction(labels, pred);
    expect(predictionStatus(labels, pred)).toBe("rejected");
    expect(labels.getEvents({ type: "not rear" })).toHaveLength(1);
  });

  it("a partly reviewed one reads as mixed", () => {
    const { labels, video, a, rear, pred } = withPrediction();
    labelRange(labels, { type: rear, video, subject: a, start: 10, end: 12 });
    labelRange(labels, { type: rear, video, subject: a, start: 15, end: 16, present: false });
    expect(predictionStatus(labels, pred)).toBe("mixed");
  });
});

describe("following a fixed identity switch", () => {
  it("bouts move to the other track over the swapped frames, and split at its ends", () => {
    const { labels, video, a, b } = project();
    const rear = addBehavior(labels, { name: "rear" });
    labelRange(labels, { type: rear, video, subject: a, start: 0, end: 9 });
    labelRange(labels, { type: rear, video, subject: b, start: 20, end: 29 });
    swapAnimalsInRange(labels, video, a, b, 5, 24);
    expect(rows(labels)).toEqual([
      ["rear", 0, 4, "a", ""],
      ["rear", 5, 9, "b", ""],
      ["rear", 20, 24, "a", ""],
      ["rear", 25, 29, "b", ""],
    ]);
  });

  it("swaps a target too, keeps a mutual pair in name order, and leaves other animals alone", () => {
    const { labels, video, a, b } = project();
    const c = new Track("c");
    const chase = addBehavior(labels, { name: "chase", directed: true });
    const sniff = addBehavior(labels, { name: "sniff", directed: true, mutual: true });
    const rear = addBehavior(labels, { name: "rear" });
    labelRange(labels, { type: chase, video, subject: a, target: c, start: 0, end: 9 });
    labelRange(labels, { type: sniff, video, subject: a, target: b, start: 10, end: 19 });
    labelRange(labels, { type: rear, video, subject: c, start: 20, end: 29 });
    swapAnimalsInRange(labels, video, a, b, 0, 100);
    expect(rows(labels)).toEqual([
      ["chase", 0, 9, "b", "c"],
      ["sniff", 10, 19, "a", "b"],
      ["rear", 20, 29, "c", ""],
    ]);
  });

  it("a prediction's framewise scores are cut to match, so the file stays valid", () => {
    const { labels, video, a, b } = project();
    const rear = addBehavior(labels, { name: "rear" });
    labels.events = [
      new PredictedEvent({ type: rear, video, startFrame: 0, endFrame: 3, subject: a, scores: [0.25, 0.5, 0.75, 1] }),
    ];
    swapAnimalsInRange(labels, video, a, b, 2, 9);
    const [before, after] = [...labels.events].sort((x, y) => x.startFrame - y.startFrame) as PredictedEvent[];
    expect(Array.from(before.scores as Float32Array)).toEqual([0.25, 0.5]);
    expect(Array.from(after.scores as Float32Array)).toEqual([0.75, 1]);
    expect(after.subject).toBe(b);
  });

  it("nothing to move, nothing changes", () => {
    const { labels, video, a, b } = project();
    const before = labels.events;
    swapAnimalsInRange(labels, video, a, b, 0, 10);
    expect(labels.events).toBe(before);
  });
});

describe("a clip", () => {
  it("takes the bouts over its range, trimmed and counted from its own start", () => {
    const { labels, video, a, b } = project();
    const rear = addBehavior(labels, { name: "rear" });
    const groom = addBehavior(labels, { name: "groom" });
    addBehavior(labels, { name: "unused" });
    labelRange(labels, { type: rear, video, subject: a, start: 90, end: 110 });
    labelRange(labels, { type: rear, video, subject: b, start: 120, end: 130 });
    labelRange(labels, { type: groom, video, subject: b, start: 0, end: 5 });
    const clip = new Video({ filename: "clip.mp4" });
    const copiedA = new Track("a");
    const out = eventsForClip(labels, video, 100, 125, clip, 100, [copiedA]);
    expect(out.eventTypes).toEqual([rear]);
    const got = out.events.map((e) => [e.startFrame, e.endFrame, e.subject?.name]).sort();
    expect(got).toEqual([
      [0, 10, "a"],
      [20, 25, "b"],
    ]);
    expect(out.events.every((e) => e.video === clip)).toBe(true);
    expect(out.events.find((e) => e.subject?.name === "a")?.subject).toBe(copiedA);
    // The project's own bouts stay where they were.
    expect(rows(labels)[1]).toEqual(["rear", 90, 110, "a", ""]);
  });
});

describe("the timeline", () => {
  it("one lane per behavior per animal, ethogram then animal order, a \"not\" on its behavior's lane", () => {
    const { labels, video, a, b } = project();
    const rear = addBehavior(labels, { name: "rear" });
    const groom = addBehavior(labels, { name: "groom" });
    labelRange(labels, { type: groom, video, subject: b, start: 0, end: 1 });
    labelRange(labels, { type: rear, video, subject: b, start: 0, end: 1 });
    labelRange(labels, { type: rear, video, subject: a, start: 0, end: 1 });
    labelRange(labels, { type: rear, video, subject: a, start: 5, end: 6, present: false });
    const lanes = behaviorLanes(labels, video);
    expect(lanes.map((l) => l.label)).toEqual(["rear · a", "rear · b", "groom · b"]);
    expect(lanes[0].bouts).toHaveLength(2);
  });
});

describe("the file", () => {
  it("a save and reopen keeps everything, by name", async () => {
    const { labels, video, a, b } = project();
    const rear = addBehavior(labels, { name: "rear", key: "r", description: "up" });
    const chase = addBehavior(labels, { name: "chase", directed: true });
    labelRange(labels, { type: rear, video, subject: a, start: 5, end: 9, note: "tall" });
    labelRange(labels, { type: rear, video, subject: a, start: 20, end: 29, present: false });
    labelRange(labels, { type: chase, video, subject: a, target: b, start: 40, end: 49 });
    labels.events = [
      ...labels.events,
      new PredictedEvent({ type: rear, video, startFrame: 60, endFrame: 69, subject: b, score: 0.75, source: "rule" }),
    ];

    const bytes = await saveSlpToBytes(labels);
    const back = await loadSlp(new Uint8Array(bytes).buffer as ArrayBuffer, { openVideos: false });
    expect(ethogram(back).map((t) => t.name)).toEqual(["rear", "chase"]);
    expect(rows(back)).toEqual(rows(labels));
    const backRear = back.eventTypes[0];
    expect(backRear.metadata.key).toBe("r");
    expect(backRear.description).toBe("up");
    expect(behaviorFields(back.eventTypes[1]).directed).toBe(true);
    expect(notTypeOf(back, backRear)?.name).toBe("not rear");
    const note = back.events.find((e) => e.startFrame === 5);
    expect(note?.metadata.note).toBe("tall");
    const pred = back.events.find((e) => e.isPredicted) as PredictedEvent;
    expect(pred.score).toBe(0.75);
    expect(pred.source).toBe("rule");
    // Editing what came back works on the file's own objects.
    expect(predictionStatus(back, pred)).toBe("open");
    acceptPrediction(back, pred);
    expect(predictionStatus(back, pred)).toBe("accepted");
    expect(behaviorLanes(back, back.videos[0]).length).toBeGreaterThan(0);
  });

  it("a project with no behaviors adds nothing to the file", async () => {
    const { labels } = project();
    const bytes = await saveSlpToBytes(labels);
    const back = await loadSlp(new Uint8Array(bytes).buffer as ArrayBuffer, { openVideos: false });
    expect(back.eventTypes).toHaveLength(0);
    expect(back.events).toHaveLength(0);
  });
});

describe("predictionStatuses", () => {
  it("says what predictionStatus says, for every prediction, on overlapping and out-of-order labels", () => {
    const { labels, video, a, b } = project();
    const rear = addBehavior(labels, { name: "rear" });
    const predictions: Event[] = [];
    // A fixed scatter of predictions and of labels, present and "not", some crossing.
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 300; i += 1) {
      const start = next(400);
      predictions.push(
        new PredictedEvent({
          type: rear,
          video,
          startFrame: start,
          endFrame: start + next(12),
          subject: i % 2 ? a : b,
          score: 0.5,
        }),
      );
    }
    labels.events.push(...predictions);
    for (let i = 0; i < 60; i += 1) {
      const start = next(400);
      labelRange(labels, {
        type: rear,
        video,
        subject: i % 3 ? a : b,
        target: null,
        start,
        end: start + next(9),
        present: i % 4 !== 0,
      });
    }
    const fast = predictionStatuses(labels, predictions);
    for (const p of predictions) {
      expect(fast.get(p)).toBe(predictionStatus(labels, p));
    }
    expect(new Set(fast.values()).size).toBeGreaterThan(1);
  });
});

describe("frameAnimals", () => {
  const skeleton = new Skeleton({ nodes: ["a"] });
  const inst = (track?: Track) => {
    const i = Instance.fromArray([[1, 2]], skeleton);
    if (track) i.track = track;
    return i;
  };

  it("names a plain project's instances by their tracks", () => {
    const { labels, video, a } = project();
    const tracked = inst(a);
    const untracked = inst();
    const frame = new LabeledFrame({ video, frameIdx: 3, instances: [tracked, untracked] });
    const animals = frameAnimals(labels, video, frame);
    expect(animals.get(tracked)).toBe(a);
    expect(animals.has(untracked)).toBe(false);
  });

  it("names a session's instances by their group's identity, on each camera", () => {
    const { labels, v0, v1, mouse } = sessionProject();
    const session = labels.sessions[0];
    const [c0, c1] = session.cameraGroup.cameras;
    const on0 = inst(new Track("cam0 track"));
    const on1 = inst(new Track("cam1 track"));
    const stray = inst();
    const group = new InstanceGroup({
      identity: mouse,
      instanceByCamera: new Map([
        [c0, on0],
        [c1, on1],
      ]),
    });
    session.frameGroups.set(5, new FrameGroup({ frameIdx: 5, instanceGroups: [group] }));
    const frame0 = new LabeledFrame({ video: v0, frameIdx: 5, instances: [on0, stray] });
    const frame1 = new LabeledFrame({ video: v1, frameIdx: 5, instances: [on1] });
    expect(frameAnimals(labels, v0, frame0).get(on0)).toBe(mouse);
    expect(frameAnimals(labels, v0, frame0).has(stray)).toBe(false);
    expect(frameAnimals(labels, v1, frame1).get(on1)).toBe(mouse);
    // Another frame's groups say nothing about this one.
    const other = new LabeledFrame({ video: v0, frameIdx: 6, instances: [on0] });
    expect(frameAnimals(labels, v0, other).size).toBe(0);
  });
});
