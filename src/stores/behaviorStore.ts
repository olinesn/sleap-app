/**
 * Label Behaviors mode: what is being coded right now. Display and coding state only,
 * never saved (a running state is written when it stops, or when the project is saved:
 * `flushRunningBehaviors`). The labels themselves are `labels.events`.
 */
import { create } from "zustand";
import type {
  EventParticipant,
  EventType,
  Video,
} from "@talmolab/sleap-io.js";

/** A state behavior started with its key and not stopped yet. */
export interface RunningBehavior {
  type: EventType;
  video: Video;
  subject: EventParticipant | null;
  target: EventParticipant | null;
  start: number;
}

/** A directed behavior waiting for its target: the next digit picks it. */
export interface PendingTarget {
  type: EventType;
  actor: EventParticipant;
  present: boolean;
}

interface BehaviorState {
  /** Is Label Behaviors mode on? */
  mode: boolean;
  /** The animal the keys label. */
  focal: EventParticipant | null;
  running: RunningBehavior[];
  pendingTarget: PendingTarget | null;
  /** Frame marked with `[`, the start of a range. */
  rangeStart: number | null;
  set: (patch: Partial<Omit<BehaviorState, "set" | "reset">>) => void;
  reset: () => void;
}

export const useBehaviorStore = create<BehaviorState>((set) => ({
  mode: false,
  focal: null,
  running: [],
  pendingTarget: null,
  rangeStart: null,
  set: (patch) => set(patch),
  reset: () =>
    set({
      mode: false,
      focal: null,
      running: [],
      pendingTarget: null,
      rangeStart: null,
    }),
}));
