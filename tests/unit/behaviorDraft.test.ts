/**
 * Behavior labels saved on their own, for a project too big to rewrite after every pause
 * in labelling (`src/lib/behaviorDraft.ts`), and how autosave chooses them
 * (`src/lib/autosaveDirty.ts`). IndexedDB is covered by the real-data run; what is pinned
 * here is that a draft restores every label as it was.
 */
import { describe, it, expect } from "../bun-test";
import {
  Identity,
  Instance,
  LabeledFrame,
  Labels,
  PredictedEvent,
  Skeleton,
  Track,
  Video,
} from "@talmolab/sleap-io.js";
import {
  addBehavior,
  labelRange,
} from "@/lib/behaviorEvents";
import {
  applyBehaviorDraft,
  behaviorDraftKey,
  behaviorDraftPrompt,
  isBigProject,
  snapshotBehavior,
  BIG_PROJECT_FLAG_KEY,
} from "@/lib/behaviorDraft";
import { DirtyFrameTracker } from "@/lib/autosaveDirty";

function project(): Labels {
  const video = new Video({ filename: "cam.mp4" });
  const labels = new Labels({ videos: [video], tracks: [new Track("t0")] });
  labels.identities.push(new Identity({ name: "a" }), new Identity({ name: "b" }));
  return labels;
}

function rows(labels: Labels) {
  return labels.events.map((e) => [
    e.type.name,
    e.type.metadata,
    e.video === labels.videos[0],
    e.startFrame,
    e.endFrame,
    e.subject?.name,
    e.target?.name,
    e.isPredicted,
    e.name,
    e.source,
    e.metadata,
    e instanceof PredictedEvent ? e.score : undefined,
    e instanceof PredictedEvent && e.scores ? Array.from(e.scores) : undefined,
  ]);
}

describe("a behavior draft", () => {
  function labelled(): Labels {
    const labels = project();
    const [a, b] = labels.identities;
    const rear = addBehavior(labels, { name: "rear", key: "r" });
    const chase = addBehavior(labels, { name: "chase", key: "c", directed: true });
    const video = labels.videos[0];
    labelRange(labels, { type: rear, video, subject: a, target: null, start: 5, end: 9, note: "tall" });
    labelRange(labels, { type: rear, video, subject: b, target: null, start: 20, end: 30, present: false });
    labelRange(labels, { type: chase, video, subject: a, target: b, start: 40, end: 41 });
    labels.events.push(
      new PredictedEvent({
        type: rear,
        video,
        startFrame: 50,
        endFrame: 52,
        subject: labels.tracks[0],
        source: "rule",
        score: 0.75,
        scores: [0.5, 0.75, 1],
      }),
    );
    return labels;
  }

  it("restores every label as it was, through plain data", () => {
    const labels = labelled();
    const want = rows(labels);
    const types = labels.eventTypes.map((t) => t.name);
    const draft = JSON.parse(JSON.stringify(snapshotBehavior(labels)));
    labels.events = [];
    labels.eventTypes = [];
    expect(applyBehaviorDraft(labels, draft)).toBe(true);
    expect(rows(labels)).toEqual(want);
    expect(labels.eventTypes.map((t) => t.name)).toEqual(types);
    // Events use the catalog's own entries, so an edit of a type reaches them.
    expect(labels.events.every((e) => labels.eventTypes.includes(e.type))).toBe(true);
  });

  it("refuses a file whose videos have changed, leaving its labels alone", () => {
    const labels = labelled();
    const draft = snapshotBehavior(labels);
    const other = project();
    other.videos.push(new Video({ filename: "second.mp4" }));
    other.events = [];
    expect(applyBehaviorDraft(other, draft)).toBe(false);
    expect(other.events).toEqual([]);
  });

  it("belongs to a file by name, size and time", () => {
    const file = new File(["abc"], "x.slp", { lastModified: 5 });
    expect(behaviorDraftKey({ projectFile: file })).toBe("x.slp|3|5");
    expect(behaviorDraftKey({ projectFile: null, projectPath: "/d/x.slp" })).toBe("/d/x.slp|");
  });
});

describe("offering a draft back", () => {
  const events = [{ predicted: false }, { predicted: false }, { predicted: true }] as never;
  const source = { size: 100, lastModified: 5000 };

  it("counts only the hand labels and asks plainly when the file is as it was", () => {
    const p = behaviorDraftPrompt({ savedAt: 1, events, source }, { size: 100, lastModified: 5000 });
    expect(p.message).toContain("Restore its 2 behavior labels?");
    expect(p.message).not.toContain("changed on disk");
    expect(p.destructive).toBe(false);
  });

  it("warns when the file changed on disk since, by size or by time", () => {
    for (const file of [{ size: 200, lastModified: 5000 }, { size: 100, lastModified: 6000 }]) {
      const p = behaviorDraftPrompt({ savedAt: 1, events, source }, file);
      expect(p.message).toContain("changed on disk");
      expect(p.message).toContain("replaces the labels the file holds now");
      expect(p.destructive).toBe(true);
    }
  });

  it("does not warn with nothing to compare: a browser draft, or a file it cannot read", () => {
    expect(behaviorDraftPrompt({ savedAt: 1, events }, { size: 200, lastModified: 6000 }).destructive).toBe(false);
    expect(behaviorDraftPrompt({ savedAt: 1, events, source }, undefined).destructive).toBe(false);
  });
});

describe("a big project", () => {
  it("is counted in instances, and the limit can be moved", () => {
    const skeleton = new Skeleton({ nodes: ["a"] });
    const video = new Video({ filename: "cam.mp4" });
    const frames = [0, 1, 2].map(
      (f) =>
        new LabeledFrame({
          video,
          frameIdx: f,
          instances: [Instance.fromArray([[1, 2]], skeleton)],
        }),
    );
    const labels = new Labels({ labeledFrames: frames, videos: [video], skeletons: [skeleton] });
    expect(isBigProject(labels)).toBe(false);
    localStorage.setItem(BIG_PROJECT_FLAG_KEY, "3");
    try {
      expect(isBigProject(labels)).toBe(true);
      localStorage.setItem(BIG_PROJECT_FLAG_KEY, "4");
      expect(isBigProject(labels)).toBe(false);
    } finally {
      localStorage.removeItem(BIG_PROJECT_FLAG_KEY);
    }
  });
});

describe("what autosave sees of a behavior edit", () => {
  const events = {
    commandName: "LabelBehaviorRange",
    frame: null,
    scopedFrames: null,
    allFrames: null,
    activeVideo: null,
    activeFrameIdx: 0,
    eventsOnly: true,
  };

  it("still asks for a full draft, unless the tick saves the labels on their own", () => {
    const tracker = new DirtyFrameTracker();
    tracker.markFromSnapshot(events);
    expect(tracker.needsFullSnapshot).toBe(true);
    expect(tracker.onlyEventsPending).toBe(true);
    expect(tracker.hasPending()).toBe(true);
    tracker.takeEvents();
    expect(tracker.needsFullSnapshot).toBe(false);
    expect(tracker.hasPending()).toBe(false);
  });

  it("is not alone once a frame or the structure changed too", () => {
    const video = new Video({ filename: "cam.mp4" });
    const withFrame = new DirtyFrameTracker();
    withFrame.markFromSnapshot(events);
    withFrame.markFrame(video, 3);
    expect(withFrame.onlyEventsPending).toBe(false);
    const withStructure = new DirtyFrameTracker();
    withStructure.markFromSnapshot(events);
    withStructure.markStructural();
    expect(withStructure.onlyEventsPending).toBe(false);
    expect(withStructure.drain().needsFullSnapshot).toBe(true);
    expect(withStructure.needsFullSnapshot).toBe(false);
  });
});
