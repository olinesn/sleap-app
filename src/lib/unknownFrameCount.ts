/**
 * A file can say a video has 0 frames when it means it does not know: LUC3D wrote that
 * for every project saved before it kept the count. `shape[0]` is the seekbar's length and
 * the limit on every frame change, so until the video itself was found nothing past frame 0
 * could be reached, labels included. Take the highest labeled frame as the count until
 * then; opening the video corrects `shape[0]` as usual.
 */
import type { Labels } from "@talmolab/sleap-io.js";

export function fillUnknownFrameCounts(labels: Labels): void {
  if (labels.isLazy) return;
  let highest: Map<unknown, number> | null = null;
  for (const video of labels.videos) {
    if (video.shape?.[0] !== 0) continue;
    if (!highest) {
      highest = new Map();
      for (const lf of labels.labeledFrames) {
        if (lf.frameIdx > (highest.get(lf.video) ?? -1)) highest.set(lf.video, lf.frameIdx);
      }
    }
    const top = highest.get(video);
    if (top !== undefined) {
      const [, ...rest] = video.shape;
      video.shape = [top + 1, ...rest] as typeof video.shape;
    }
  }
}
