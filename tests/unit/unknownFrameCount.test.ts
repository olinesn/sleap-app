/**
 * A video whose file says 0 frames: frame changes must still reach its labels.
 */
import { describe, it, expect, beforeEach } from "../bun-test";
import { useAppStore } from "@/stores/appStore";
import { fillUnknownFrameCounts } from "@/lib/unknownFrameCount";
import { Instance, Labels, LabeledFrame, Skeleton, Video } from "@talmolab/sleap-io.js";

const skeleton = new Skeleton({ nodes: ["a"], name: "s" });

function videoOf(shape: [number, number, number, number]): Video {
  const v = new Video({ filename: "/v.mp4", openBackend: false });
  v.shape = shape;
  return v;
}

function labelsOn(video: Video, frames: number[]): Labels {
  return new Labels({
    labeledFrames: frames.map(
      (f) => new LabeledFrame({ video, frameIdx: f, instances: [Instance.fromArray([[1, 1]], skeleton)] }),
    ),
    videos: [video],
    skeletons: [skeleton],
  });
}

describe("A video whose file says 0 frames", () => {
  beforeEach(() => useAppStore.setState(useAppStore.getInitialState()));

  it("can be stepped through to its last labeled frame", () => {
    const video = videoOf([0, 1024, 1280, 1]);
    const labels = labelsOn(video, [3, 300, 12]);
    useAppStore.getState().setLabels(labels);
    expect(video.shape).toEqual([301, 1024, 1280, 1]);
    useAppStore.getState().setFrameIdx(300);
    expect(useAppStore.getState().frameIdx).toBe(300);
    useAppStore.getState().setFrameIdx(5000);
    expect(useAppStore.getState().frameIdx).toBe(300);
  });

  it("stays as it is with no labels to go by", () => {
    const video = videoOf([0, 10, 10, 1]);
    fillUnknownFrameCounts(new Labels({ labeledFrames: [], videos: [video], skeletons: [skeleton] }));
    expect(video.shape).toEqual([0, 10, 10, 1]);
  });

  it("each video takes its own count, and a known count stays", () => {
    const a = videoOf([0, 10, 10, 1]);
    const b = videoOf([600, 10, 10, 1]);
    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({ video: a, frameIdx: 7, instances: [Instance.fromArray([[1, 1]], skeleton)] }),
        new LabeledFrame({ video: b, frameIdx: 9, instances: [Instance.fromArray([[1, 1]], skeleton)] }),
      ],
      videos: [a, b],
      skeletons: [skeleton],
    });
    fillUnknownFrameCounts(labels);
    expect(a.shape).toEqual([8, 10, 10, 1]);
    expect(b.shape).toEqual([600, 10, 10, 1]);
  });
});
