/**
 * A file LUC3D wrote (`tests/fixtures/luc3d_behavior.slp`): two cameras, identities,
 * labels, a "not", social and mutual behaviors, a point, predictions, and what only LUC3D
 * reads in `metadata.lucid`. Pins that this app reads what LUC3D means, and that editing
 * and saving here leaves the rest of the file for LUC3D. The live two-way test is LUC3D's
 * `tests/e2e/behavior-cross-app.mjs`, which remakes this fixture.
 */
import { describe, it, expect } from "../bun-test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadSlp, saveSlpToBytes, type Labels } from "@talmolab/sleap-io.js";
import {
  acceptPrediction,
  addBehavior,
  behaviorAnimals,
  behaviorFields,
  behaviorOfEvent,
  ethogram,
  eventsForVideo,
  labelRange,
  notTypeOf,
  predictionStatus,
} from "@/lib/behaviorEvents";

const FIXTURE = path.resolve(import.meta.dir, "../fixtures/luc3d_behavior.slp");

async function open(): Promise<Labels> {
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  return loadSlp(bytes.buffer as ArrayBuffer, { openVideos: false });
}

const lucidOf = (labels: Labels) =>
  (labels.sessions[0].metadata as { lucid: Record<string, unknown> }).lucid;

describe("a file from LUC3D", () => {
  it("has its ethogram, in LUC3D's words", async () => {
    const labels = await open();
    const types = ethogram(labels);
    expect(types.map((t) => t.name)).toEqual(["rear", "chase", "nose-to-nose", "bite"]);
    expect(behaviorFields(types[0]).key).toBe("r");
    expect(types[0].description).toBe("both forepaws off the floor");
    expect(behaviorFields(types[1]).directed).toBe(true);
    expect(behaviorFields(types[1]).mutual).toBe(false);
    expect(behaviorFields(types[2]).mutual).toBe(true);
    expect(behaviorFields(types[3]).kind).toBe("point");
    expect(notTypeOf(labels, types[0])?.name).toBe("not rear");
  });

  it("its animals are the identities, and its bouts show on both cameras", async () => {
    const labels = await open();
    expect(behaviorAnimals(labels).map((a) => a.name)).toEqual(["mouseA", "mouseB"]);
    expect(labels.videos).toHaveLength(2);
    const onFirst = eventsForVideo(labels, labels.videos[0]);
    const onSecond = eventsForVideo(labels, labels.videos[1]);
    expect(onFirst).toHaveLength(7);
    expect(onSecond).toHaveLength(7);
    const not = onFirst.find((e) => e.type.name === "not rear");
    expect(behaviorOfEvent(labels, not!)?.name).toBe("rear");
    const note = onFirst.find((e) => e.type.name === "rear" && !e.isPredicted);
    expect(note?.metadata.note).toBe("tall");
    expect(note?.source).toBe("manual");
    const preds = onFirst.filter((e) => e.isPredicted);
    expect(preds.map((e) => e.source)).toEqual(["rule", "rule"]);
    expect(predictionStatus(labels, preds[0])).toBe("open");
  });

  it("saved here, it keeps LUC3D's own data and gains the edits", async () => {
    const labels = await open();
    const before = JSON.stringify(lucidOf(labels));
    expect(Object.keys(lucidOf(labels))).toContain("behaviorStates");
    const [a] = behaviorAnimals(labels);
    const groom = addBehavior(labels, { name: "groom", key: "g" });
    labelRange(labels, { type: groom, video: labels.videos[1], subject: a, start: 86, end: 90 });
    acceptPrediction(labels, labels.events.find((e) => e.isPredicted)!);

    const bytes = await saveSlpToBytes(labels);
    const back = await loadSlp(new Uint8Array(bytes).buffer as ArrayBuffer, { openVideos: false });
    expect(JSON.stringify(lucidOf(back))).toBe(before);
    expect(back.sessions).toHaveLength(1);
    expect(back.identities.map((i) => i.name)).toEqual(["mouseA", "mouseB"]);
    const added = back.events.find((e) => e.type.name === "groom");
    expect(added?.video).toBe(back.videos[0]); // the session's first camera
    expect(added?.subject?.name).toBe(a.name);
    expect(back.events.some((e) => e.source === "accepted_prediction")).toBe(true);
    // LUC3D's id for a behavior is its key to what only it reads.
    expect(back.eventTypes[0].metadata.lucid_id).toBe(labels.eventTypes[0].metadata.lucid_id);
    expect(back.eventTypes[0].metadata.lucid_id).toMatch(/^b\d+$/);
  });
});
