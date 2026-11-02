/**
 * Behavior label commands: every edit of `labels.events` / `labels.eventTypes` goes
 * through here, so each is one undo step and marks the project changed. They edit no
 * frame, so the undo snapshot is the events alone (`takeEventsSnapshot`), and an edit
 * forces a full autosave base (a frame delta cannot express events; this is the default
 * for any command `autosaveDirty.ts` does not list as frame-level).
 */
import type { Event, EventType, Video } from "@talmolab/sleap-io.js";
import { UpdateTopic } from "../types";
import type { Command } from "./types";
import type { CommandContext } from "./CommandContext";
import {
  acceptPrediction,
  addBehavior,
  deleteBout,
  editBout,
  labelRange,
  rejectPrediction,
  removeBehavior,
  updateBehavior,
  type BehaviorFields,
  type BoutChanges,
  type LabelRangeOptions,
} from "@/lib/behaviorEvents";

/** A command that edits only events: snapshot them, edit, mark changed. */
function behaviorCommand(
  name: string,
  edit: (
    ctx: CommandContext,
    labels: NonNullable<CommandContext["state"]["labels"]>,
    params: Record<string, unknown>,
  ) => void,
): Command {
  return {
    name,
    topics: [UpdateTopic.Labels],
    skipAutoSnapshot: true,
    execute(ctx, params) {
      const { labels } = ctx.state;
      if (!labels) return;
      ctx.pushUndoSnapshot(ctx.takeEventsSnapshot(name));
      edit(ctx, labels, params ?? {});
      ctx.state.markChanged();
    },
  };
}

/** Params: {@link LabelRangeOptions} without the video (defaults to the one on screen). */
export const LabelBehaviorRange = behaviorCommand(
  "LabelBehaviorRange",
  (ctx, labels, params) => {
    const video = (params.video as Video | undefined) ?? ctx.state.video;
    if (!video) return;
    labelRange(labels, { ...(params as unknown as LabelRangeOptions), video });
  },
);

/** Params: { fields: BehaviorFields }. */
export const AddBehavior = behaviorCommand("AddBehavior", (_ctx, labels, params) => {
  addBehavior(labels, params.fields as BehaviorFields);
});

/** Params: { type: EventType, fields: BehaviorFields }. */
export const UpdateBehavior = behaviorCommand(
  "UpdateBehavior",
  (_ctx, labels, params) => {
    updateBehavior(labels, params.type as EventType, params.fields as BehaviorFields);
  },
);

/** Params: { type: EventType }. */
export const RemoveBehavior = behaviorCommand(
  "RemoveBehavior",
  (_ctx, labels, params) => {
    removeBehavior(labels, params.type as EventType);
  },
);

/** Params: { bout: Event }. */
export const DeleteBout = behaviorCommand("DeleteBout", (_ctx, labels, params) => {
  deleteBout(labels, params.bout as Event);
});

/** Params: { bout: Event, changes: BoutChanges }. */
export const EditBout = behaviorCommand("EditBout", (_ctx, labels, params) => {
  editBout(labels, params.bout as Event, params.changes as BoutChanges);
});

/** Params: { prediction: Event }. */
export const AcceptPrediction = behaviorCommand(
  "AcceptPrediction",
  (_ctx, labels, params) => {
    acceptPrediction(labels, params.prediction as Event);
  },
);

/** Params: { prediction: Event }. */
export const RejectPrediction = behaviorCommand(
  "RejectPrediction",
  (_ctx, labels, params) => {
    rejectPrediction(labels, params.prediction as Event);
  },
);

