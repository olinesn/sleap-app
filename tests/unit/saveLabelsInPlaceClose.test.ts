/**
 * `saveLabelsInPlace` once its write has begun: closing the writer writes the last
 * of the file, and this is the user's real file, so a failed close fails the save
 * and says the file may be inconsistent, with no verify reporting it as fine. An
 * earlier error stays the one thrown. io's writer/reader and the native file
 * commands are mocked; the fallback paths are in saveLabelsInPlace.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "../bun-test";

const WRITE_FAILED = "Could not write 96 bytes at offset 0 of the file.";

const calls: string[] = [];
let openImpl: () => Promise<void>;
let updateImpl: () => Promise<{ success: boolean; error?: string }>;
let closeImpl: () => Promise<void>;

const emptyTable = { fields: ["x", "y"], rows: [] };

vi.mock("@talmolab/sleap-io.js", () => ({
  buildMetadataJson: () => "{}",
  buildLabelTableUpdate: () => ({
    frames: emptyTable,
    instances: emptyTable,
    points: emptyTable,
    predPoints: emptyTable,
  }),
  buildExpectedSidecars: () => ({}),
  buildVideoSignatures: () => [],
  checkInPlaceWritable: () => ({ ok: true }),
  onDiskTableFromMeta: () => ({}),
  StreamingH5File: class {
    async openRange() {
      calls.push("reader.open");
    }
    keys() {
      return [];
    }
    async getAttrs() {
      return {};
    }
    async close() {}
  },
  StreamingH5Writer: class {
    async openWrite() {
      calls.push("writer.open");
      await openImpl();
    }
    async updateLabelsInPlace() {
      calls.push("update");
      return updateImpl();
    }
    async close() {
      calls.push("writer.close");
      await closeImpl();
    }
  },
}));
vi.mock("@/lib/nativeWrite", () => ({
  withNativeWriteHandle: <T,>(work: () => Promise<T>) => work(),
  writeOpenAppend: async () => {
    calls.push("native.open");
  },
  writeAt: async () => {},
  readAt: async () => new Uint8Array(0),
  truncateFile: async () => {},
  writeClose: async () => {
    calls.push("native.close");
  },
}));
vi.mock("@/lib/nativeRange", () => ({
  fileSize: async () => 10,
  readRange: async () => new Uint8Array(0),
}));

const { saveLabelsInPlace } = await import("@/lib/saveLabelsInPlace");

const labels = {} as never;
const failedClose = async () => {
  throw new Error(WRITE_FAILED);
};

beforeEach(() => {
  calls.length = 0;
  Object.defineProperty(globalThis, "crossOriginIsolated", { value: true, configurable: true });
  openImpl = async () => {};
  updateImpl = async () => ({ success: true });
  closeImpl = async () => {};
});

describe("saveLabelsInPlace — closing the writer", () => {
  it("a healthy save closes the writer and the native handle, then verifies", async () => {
    await expect(saveLabelsInPlace(labels, "/p.pkg.slp")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      "reader.open", // the probe
      "native.open",
      "writer.open",
      "update",
      "writer.close",
      "native.close",
      "reader.open", // the verify
    ]);
  });

  it("a rejected close fails the save, says the file may be inconsistent, and skips the verify", async () => {
    closeImpl = failedClose;
    const err = await saveLabelsInPlace(labels, "/p.pkg.slp").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(WRITE_FAILED);
    expect((err as Error).message).toContain("reopen to check");
    expect(calls).toEqual([
      "reader.open", // the probe, and no verify after it
      "native.open",
      "writer.open",
      "update",
      "writer.close",
      "native.close",
    ]);
  });

  it("an error reported by the update stays the one thrown when the close rejects too", async () => {
    updateImpl = async () => ({ success: false, error: "table too small" });
    closeImpl = failedClose;
    await expect(saveLabelsInPlace(labels, "/p.pkg.slp")).rejects.toThrow(
      "updateLabelsInPlace failed: table too small"
    );
    expect(calls.slice(-2)).toEqual(["writer.close", "native.close"]);
    expect(calls.filter((c) => c === "writer.close")).toHaveLength(1);
  });

  it("a thrown update error stays the one thrown when the close rejects too", async () => {
    updateImpl = async () => {
      throw new Error("the disk is full");
    };
    closeImpl = failedClose;
    await expect(saveLabelsInPlace(labels, "/p.pkg.slp")).rejects.toThrow("the disk is full");
    expect(calls.slice(-2)).toEqual(["writer.close", "native.close"]);
  });

  it("a failure to open stays the one thrown when the close rejects too", async () => {
    openImpl = async () => {
      throw new Error("could not open the file");
    };
    closeImpl = failedClose;
    await expect(saveLabelsInPlace(labels, "/p.pkg.slp")).rejects.toThrow("could not open the file");
    expect(calls.slice(-2)).toEqual(["writer.close", "native.close"]);
  });
});
