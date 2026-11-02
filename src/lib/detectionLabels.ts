/**
 * What a detection carries besides its pose and track: a tracker's score, and from a
 * model an identity and category with their scores and embeddings. The instance
 * constructors do not take most of these, so anything that rebuilds an instance (undo,
 * accepting a prediction) loses them unless it copies them here.
 */
import type { Instance } from "@talmolab/sleap-io.js";

export function copyDetectionLabels(from: Instance, to: Instance): void {
  to.trackingScore = from.trackingScore;
  to.identity = from.identity;
  to.identityScore = from.identityScore;
  to.identityEmbedding = from.identityEmbedding;
  to.category = from.category;
  to.categoryScore = from.categoryScore;
  to.categoryEmbedding = from.categoryEmbedding;
}

/**
 * Mark `copy` as the same detection as `original`, for an undo that puts copies back.
 * A multi-camera group holds the instance it was read with; sleap-io.js follows this link
 * to the copy, however far either has moved since (`Instance.copyOf`). Not saved.
 */
export function markCopyOf(original: Instance, copy: Instance): void {
  type Linked = Instance & { copyOf?: Instance | null };
  (copy as Linked).copyOf = (original as Linked).copyOf ?? original;
}
