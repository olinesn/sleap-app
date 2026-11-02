/**
 * Label Behaviors mode (`src/lib/behaviorCoding.ts`) and the behavior commands' undo: a key
 * starts and stops a state, labels a point or a range; digits pick the animal or a target;
 * a state still running is written by a save and replaced when it stops. Each edit is one
 * undo step that leaves the frames and the view alone.
 */
import { describe, it, expect, beforeEach } from "../bun-test";
import { Labels, Track, Video } from "@talmolab/sleap-io.js";
import { commandContext } from "@/commands/CommandContext";
import {
  AddBehavior,
  LabelBehaviorRange,
  RemoveBehavior,
} from "@/commands/behaviorCommands";
import { useAppStore } from "@/stores/appStore";
import { useBehaviorStore } from "@/stores/behaviorStore";
import {
  flushRunningBehaviors,
  focalAnimal,
  handleBehaviorKey,
  markRangeEnd,
  markRangeStart,
  setBehaviorMode,
} from "@/lib/behaviorCoding";
import { addBehavior, ethogram } from "@/lib/behaviorEvents";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods }) as KeyboardEvent;

function start(animals: string[] = ["a", "b"]) {
  useAppStore.setState(useAppStore.getInitialState());
  useBehaviorStore.getState().reset();
  const video = new Video({ filename: "v.mp4" });
  const tracks = animals.map((n) => new Track(n));
  const labels = new Labels({ videos: [video], tracks });
  useAppStore.setState({ labels, video, frameIdx: 0 });
  const rear = addBehavior(labels, { name: "rear", key: "r" });
  const bite = addBehavior(labels, { name: "bite", key: "b", kind: "point" });
  const chase = addBehavior(labels, { name: "chase", key: "c", directed: true });
  setBehaviorMode(true);
  return { labels, video, tracks, rear, bite, chase };
}

const goTo = (f: number) => useAppStore.setState({ frameIdx: f });
const rows = (labels: Labels) =>
  labels.events
    .map((e) => [e.type.name, e.startFrame, e.endFrame, e.subject?.name ?? "", e.target?.name ?? ""])
    .sort((x, y) => (x[1] as number) - (y[1] as number));

/** Commands run asynchronously but do their work before the first await. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("Label Behaviors mode", () => {
  beforeEach(() => {
    useBehaviorStore.getState().reset();
  });

  it("takes no key while off, and leaves other keys alone while on", () => {
    start();
    setBehaviorMode(false);
    expect(handleBehaviorKey(key("r"))).toBe(false);
    setBehaviorMode(true);
    expect(handleBehaviorKey(key("z"))).toBe(false);
    expect(handleBehaviorKey(key("ArrowRight"))).toBe(false);
    expect(handleBehaviorKey(key("r", { metaKey: true }))).toBe(false);
    expect(handleBehaviorKey(key("r", { ctrlKey: true }))).toBe(false);
  });

  it("a state starts and stops with its key", async () => {
    const { labels } = start();
    goTo(10);
    expect(handleBehaviorKey(key("r"))).toBe(true);
    expect(labels.events).toHaveLength(0);
    expect(useBehaviorStore.getState().running).toHaveLength(1);
    goTo(20);
    handleBehaviorKey(key("r"));
    await settle();
    expect(useBehaviorStore.getState().running).toHaveLength(0);
    expect(rows(labels)).toEqual([["rear", 10, 20, "a", ""]]);
  });

  it("two animals can run the same state at once", async () => {
    const { labels } = start();
    goTo(0);
    handleBehaviorKey(key("r"));
    handleBehaviorKey(key("2"));
    goTo(5);
    handleBehaviorKey(key("r"));
    goTo(9);
    handleBehaviorKey(key("r"));          // stops b's
    handleBehaviorKey(key("1"));
    goTo(12);
    handleBehaviorKey(key("r"));          // stops a's
    await settle();
    expect(rows(labels)).toEqual([
      ["rear", 0, 12, "a", ""],
      ["rear", 5, 9, "b", ""],
    ]);
  });

  it("a point labels the frame", async () => {
    const { labels } = start();
    goTo(7);
    handleBehaviorKey(key("b"));
    await settle();
    expect(rows(labels)).toEqual([["bite", 7, 7, "a", ""]]);
    expect(useBehaviorStore.getState().running).toHaveLength(0);
  });

  it("digits pick the animal", () => {
    const { labels, tracks } = start();
    expect(focalAnimal(labels)).toBe(tracks[0]);
    handleBehaviorKey(key("2"));
    expect(focalAnimal(labels)).toBe(tracks[1]);
    handleBehaviorKey(key("9"));
    expect(focalAnimal(labels)).toBe(tracks[1]);
  });

  it("a directed behavior takes the only other animal as its target", async () => {
    const { labels } = start();
    goTo(3);
    handleBehaviorKey(key("c"));
    goTo(8);
    handleBehaviorKey(key("c"));
    await settle();
    expect(rows(labels)).toEqual([["chase", 3, 8, "a", "b"]]);
  });

  it("with more animals it waits for a digit, and Esc cancels the wait", async () => {
    const { labels } = start(["a", "b", "c"]);
    goTo(3);
    handleBehaviorKey(key("c"));
    expect(useBehaviorStore.getState().pendingTarget?.type.name).toBe("chase");
    expect(useBehaviorStore.getState().running).toHaveLength(0);
    handleBehaviorKey(key("Escape"));
    expect(useBehaviorStore.getState().pendingTarget).toBeNull();
    expect(useBehaviorStore.getState().mode).toBe(true);
    handleBehaviorKey(key("c"));
    handleBehaviorKey(key("1"));          // the actor cannot be its own target
    expect(useBehaviorStore.getState().pendingTarget).not.toBeNull();
    handleBehaviorKey(key("3"));
    expect(useBehaviorStore.getState().running[0].target?.name).toBe("c");
    goTo(6);
    handleBehaviorKey(key("c"));          // stops it, no target asked
    await settle();
    expect(rows(labels)).toEqual([["chase", 3, 6, "a", "c"]]);
  });

  it("a selected range is labelled whole; Shift labels it \"not\"", async () => {
    const { labels } = start();
    useAppStore.getState().set("frameRange", [10, 19]);
    handleBehaviorKey(key("r"));
    await settle();
    expect(rows(labels)).toEqual([["rear", 10, 19, "a", ""]]);
    expect(useBehaviorStore.getState().running).toHaveLength(0);
    useAppStore.getState().set("frameRange", [12, 13]);
    handleBehaviorKey(key("R", { shiftKey: true }));
    await settle();
    expect(rows(labels)).toEqual([
      ["rear", 10, 11, "a", ""],
      ["not rear", 12, 13, "a", ""],
      ["rear", 14, 19, "a", ""],
    ]);
    // Shift without a range is someone else's shortcut.
    useAppStore.getState().set("frameRange", null);
    expect(handleBehaviorKey(key("R", { shiftKey: true }))).toBe(false);
  });

  it("[ and ] select a range", () => {
    start();
    goTo(30);
    markRangeStart();
    goTo(20);
    markRangeEnd();
    expect(useAppStore.getState().frameRange).toEqual([20, 30]);
    expect(useBehaviorStore.getState().rangeStart).toBeNull();
  });

  it("leaving the mode stops what is running", async () => {
    const { labels } = start();
    goTo(4);
    handleBehaviorKey(key("r"));
    goTo(9);
    handleBehaviorKey(key("Escape"));
    await settle();
    expect(useBehaviorStore.getState().mode).toBe(false);
    expect(rows(labels)).toEqual([["rear", 4, 9, "a", ""]]);
  });

  it("a save writes a running state to the playhead, and it keeps running", async () => {
    const { labels } = start();
    goTo(4);
    handleBehaviorKey(key("r"));
    goTo(9);
    flushRunningBehaviors();
    expect(rows(labels)).toEqual([["rear", 4, 9, "a", ""]]);
    expect(useBehaviorStore.getState().running).toHaveLength(1);
    expect(useAppStore.getState().hasChanges).toBe(true);
    goTo(15);
    handleBehaviorKey(key("r"));
    await settle();
    expect(rows(labels)).toEqual([["rear", 4, 15, "a", ""]]);
  });

  it("a project with no animals labels the frame itself", async () => {
    const { labels } = start([]);
    goTo(2);
    handleBehaviorKey(key("b"));
    await settle();
    expect(rows(labels)).toEqual([["bite", 2, 2, "", ""]]);
    handleBehaviorKey(key("c"));
    await settle();
    expect(labels.events).toHaveLength(1);
  });
});

describe("undo", () => {
  it("each edit is one step, for labels and for the ethogram, and undo moves no view", async () => {
    const { labels, video, tracks, rear } = start();
    const fresh = commandContext.canUndo;
    void fresh;
    await commandContext.execute(LabelBehaviorRange, { type: rear, video, subject: tracks[0], start: 0, end: 9 });
    expect(labels.events).toHaveLength(1);
    await commandContext.execute(AddBehavior, { fields: { name: "groom", key: "g" } });
    expect(ethogram(labels).map((t) => t.name)).toEqual(["rear", "bite", "chase", "groom"]);
    goTo(40);
    expect(commandContext.undo()).toBe(true);
    expect(ethogram(labels).map((t) => t.name)).toEqual(["rear", "bite", "chase"]);
    expect(labels.events).toHaveLength(1);
    expect(commandContext.undo()).toBe(true);
    expect(labels.events).toHaveLength(0);
    expect(useAppStore.getState().frameIdx).toBe(40);
    expect(commandContext.redo()).toBe(true);
    expect(labels.events).toHaveLength(1);
    expect(labels.events[0].type).toBe(rear);
  });

  it("removing a behavior comes back with its bouts", async () => {
    const { labels, video, tracks, rear } = start();
    await commandContext.execute(LabelBehaviorRange, { type: rear, video, subject: tracks[0], start: 0, end: 9 });
    await commandContext.execute(RemoveBehavior, { type: rear });
    expect(labels.events).toHaveLength(0);
    expect(ethogram(labels)).not.toContain(rear);
    commandContext.undo();
    expect(labels.events).toHaveLength(1);
    expect(ethogram(labels)).toContain(rear);
  });

  it("an edit marks the project changed and bumps the edit counter", async () => {
    const { video, tracks, rear } = start();
    useAppStore.setState({ hasChanges: false });
    const before = useAppStore.getState().editSeq;
    await commandContext.execute(LabelBehaviorRange, { type: rear, video, subject: tracks[0], start: 0, end: 9 });
    expect(useAppStore.getState().hasChanges).toBe(true);
    expect(useAppStore.getState().editSeq).toBeGreaterThan(before);
  });
});
