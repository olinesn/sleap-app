/**
 * What a detection carries besides its pose and track (a tracker's score, an identity, a
 * category) must survive what rebuilds it: undo, accepting a prediction, crash recovery.
 */
import { describe, it, expect, beforeEach } from "../bun-test";
import { CommandContext } from "@/commands/CommandContext";
import { useAppStore } from "@/stores/appStore";
import {
  ConvertPredictionToInstance,
  AddInstancesFromAllPredictions,
  AddInstancesFromAllPredictionsInProject,
  DeleteFramePredictions,
} from "@/commands/editCommands";
import type { Command } from "@/commands/types";
import {
  applyDeltas,
  buildBaseIndex,
  decodeJournal,
  encodeFrameDelta,
  frameDeltaToRecord,
} from "@/lib/autosaveJournal";
import {
  Embedding,
  Identity,
  Instance,
  Labels,
  LabeledFrame,
  PredictedInstance,
  Skeleton,
  Track,
  Video,
} from "@talmolab/sleap-io.js";

const skeleton = new Skeleton({ nodes: ["a", "b"], name: "s" });

function labelled(identities: Identity[], x: number, a: number): PredictedInstance {
  const inst = PredictedInstance.fromArray(
    [
      [x, x],
      [x + 1, x + 1],
    ],
    skeleton,
  );
  inst.score = 0.9;
  inst.trackingScore = 0.75;
  inst.identity = identities[a];
  inst.identityScore = 0.5;
  inst.identityEmbedding = new Embedding([x, 1]);
  inst.category = "mouse";
  inst.categoryScore = 0.25;
  inst.categoryEmbedding = new Embedding([x, 2]);
  return inst;
}

function project(): { labels: Labels; video: Video; identities: Identity[] } {
  const video = new Video({ filename: "/v.mp4", backendMetadata: { shape: [10, 64, 64, 1] }, openBackend: false });
  const identities = [new Identity({ name: "female" }), new Identity({ name: "male" })];
  const labels = new Labels({
    labeledFrames: [0, 1].map(
      (f) =>
        new LabeledFrame({
          video,
          frameIdx: f,
          instances: [labelled(identities, 10 + f, 0), labelled(identities, 20 + f, 1)],
        }),
    ),
    videos: [video],
    skeletons: [skeleton],
    identities,
  });
  return { labels, video, identities };
}

function expectLabels(inst: Instance, identity: Identity, x: number): void {
  expect(inst.trackingScore).toBe(0.75);
  expect(inst.identity).toBe(identity);
  expect(inst.identityScore).toBe(0.5);
  expect(inst.identityEmbedding?.vector).toEqual([x, 1]);
  expect(inst.category).toBe("mouse");
  expect(inst.categoryScore).toBe(0.25);
  expect(inst.categoryEmbedding?.vector).toEqual([x, 2]);
}

describe("What a detection carries besides its pose", () => {
  let ctx: CommandContext;
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    ctx = new CommandContext();
  });
  const open = () => {
    const p = project();
    useAppStore.setState({ labels: p.labels, video: p.video, frameIdx: 0 });
    return p;
  };

  it("survives undo on one frame", async () => {
    const { labels, identities } = open();
    await ctx.execute(DeleteFramePredictions);
    expect(labels.labeledFrames.find((f) => f.frameIdx === 0)?.instances.length ?? 0).toBe(0);
    await ctx.undo();
    const lf = labels.labeledFrames.find((f) => f.frameIdx === 0)!;
    expect(lf.instances).toHaveLength(2);
    expectLabels(lf.instances[0], identities[0], 10);
    expectLabels(lf.instances[1], identities[1], 20);
  });

  it("survives undo across the whole project", async () => {
    const { labels, identities } = open();
    const wipe: Command = {
      name: "WipeProject",
      skipAutoSnapshot: true,
      topics: [],
      execute(c: CommandContext) {
        c.pushUndoSnapshot(c.takeAllFramesSnapshot("WipeProject"));
        labels.labeledFrames.length = 0;
      },
    } as unknown as Command;
    await ctx.execute(wipe);
    await ctx.undo();
    expect(labels.labeledFrames).toHaveLength(2);
    expectLabels(labels.labeledFrames[1].instances[1], identities[1], 21);
  });

  it("an undo keeps a user instance's link to the prediction beside it", async () => {
    const { labels, video } = open();
    const lf = labels.find({ video, frameIdx: 0 })[0];
    const predicted = lf.instances[0] as PredictedInstance;
    const user = Instance.fromArray(
      [
        [1, 1],
        [2, 2],
      ],
      skeleton,
    );
    user.fromPredicted = predicted;
    lf.instances.push(user);
    const external = new PredictedInstance({ points: predicted.points as never, skeleton, score: 0.1 });
    const other = Instance.fromArray(
      [
        [3, 3],
        [4, 4],
      ],
      skeleton,
    );
    other.fromPredicted = external;
    lf.instances.push(other);
    await ctx.execute(DeleteFramePredictions);
    await ctx.undo();
    const back = labels.find({ video, frameIdx: 0 })[0];
    const copy = back.instances[2];
    expect(copy.fromPredicted).toBe(back.instances[0] as PredictedInstance);
    expect(back.instances[3].fromPredicted).toBe(external);
  });

  it("stays on an accepted prediction", async () => {
    const { labels, video, identities } = open();
    await ctx.execute(ConvertPredictionToInstance, { instanceIdx: 1 });
    const lf = labels.find({ video, frameIdx: 0 })[0];
    expect(lf.instances[1].constructor).toBe(Instance);
    expectLabels(lf.instances[1], identities[1], 20);
  });

  it("stays when every prediction on a frame, or in the project, is accepted", async () => {
    const { labels, video, identities } = open();
    await ctx.execute(AddInstancesFromAllPredictions);
    expectLabels(labels.find({ video, frameIdx: 0 })[0].instances[0], identities[0], 10);
    await ctx.execute(AddInstancesFromAllPredictionsInProject);
    expectLabels(labels.find({ video, frameIdx: 1 })[0].instances[1], identities[1], 21);
  });

  it("survives crash recovery", () => {
    const { labels, identities } = project();
    const record = frameDeltaToRecord(encodeFrameDelta(labels.labeledFrames[0], buildBaseIndex(labels)));
    const { deltas } = decodeJournal(record);
    const base = project();
    applyDeltas(base.labels, deltas);
    const lf = base.labels.labeledFrames[0];
    expectLabels(lf.instances[0], base.identities[0], 10);
    expectLabels(lf.instances[1], base.identities[1], 20);
    void identities;
  });

  it("a missing node stays missing through crash recovery", () => {
    const { labels } = project();
    const inst = labels.labeledFrames[0].instances[0];
    inst.points[1].xy = [NaN, NaN];
    inst.points[1].visible = false;
    const record = frameDeltaToRecord(encodeFrameDelta(labels.labeledFrames[0], buildBaseIndex(labels)));
    const base = project();
    applyDeltas(base.labels, decodeJournal(record).deltas);
    const xy = base.labels.labeledFrames[0].instances[0].points[1].xy;
    expect(Number.isNaN(xy[0]) && Number.isNaN(xy[1])).toBe(true);
    expect(base.labels.labeledFrames[0].instances[0].points[0].xy).toEqual([10, 10]);
  });

  it("an accepted prediction keeps its link through crash recovery", () => {
    const { labels } = project();
    const lf = labels.labeledFrames[0];
    const user = Instance.fromArray(
      [
        [1, 1],
        [2, 2],
      ],
      skeleton,
    );
    user.fromPredicted = lf.instances[1] as PredictedInstance;
    lf.instances.push(user);
    const record = frameDeltaToRecord(encodeFrameDelta(lf, buildBaseIndex(labels)));
    const base = project();
    applyDeltas(base.labels, decodeJournal(record).deltas);
    const back = base.labels.labeledFrames[0];
    expect(back.instances[2].fromPredicted).toBe(back.instances[1] as PredictedInstance);
  });

  it("an undo marks each copy as the detection it was copied from", async () => {
    const { labels, video } = open();
    const lf = labels.find({ video, frameIdx: 0 })[0];
    const [a, b] = lf.instances;
    await ctx.execute(DeleteFramePredictions);
    await ctx.undo();
    const back = labels.find({ video, frameIdx: 0 })[0];
    type Linked = Instance & { copyOf?: Instance };
    expect((back.instances[0] as Linked).copyOf).toBe(a);
    expect((back.instances[1] as Linked).copyOf).toBe(b);

    // A second round still points at the first original.
    await ctx.execute(DeleteFramePredictions);
    await ctx.undo();
    const again = labels.find({ video, frameIdx: 0 })[0];
    expect((again.instances[0] as Linked).copyOf).toBe(a);
  });

  it("adds nothing to a crash record when there is none", () => {
    const video = new Video({ filename: "/v.mp4", openBackend: false });
    const track = new Track("t");
    const inst = PredictedInstance.fromArray([[1, 1], [2, 2]], skeleton);
    inst.track = track;
    const labels = new Labels({
      labeledFrames: [new LabeledFrame({ video, frameIdx: 0, instances: [inst] })],
      videos: [video],
      skeletons: [skeleton],
      tracks: [track],
    });
    const delta = encodeFrameDelta(labels.labeledFrames[0], buildBaseIndex(labels));
    expect(Object.keys(delta.ins[0]).sort()).toEqual(["k", "p", "pts", "s", "t"]);
  });
});
