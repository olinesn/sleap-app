/**
 * saveEmbeddedPkgStreaming's new-embed path (Export Labels Package from an
 * mp4 project): with no already-embedded images there is no source file, so
 * the stage file is opened on its own (`openWrite`) and io's
 * `appendEncodedVideos` streams the frames into it; the encoded videos are
 * verified like copied ones, and a cancelled export leaves no file behind.
 * Closing the writer writes the last of the file, so a failed close fails the
 * save on both of its routes (copying stored images, embedding new frames).
 * io's writer/reader and the native file commands are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "../bun-test";

class ExportCancelled extends Error {}

const calls: string[] = [];
const files = new Map<string, number>(); // path -> size
let appendImpl: (opts: { onProgress?: (c: number, t: number) => unknown }) => Promise<void>;
let copyImpl: () => Promise<{ success: boolean; error?: string }>;
let closeImpl: () => Promise<void>;
let stagingDirExists: boolean;
let plan: {
  sourcePath: string;
  entries: Array<{ videoIndex: number; frameNumbers: number[] }>;
  encodeEntries: Array<{ videoIndex: number; frameNumbers: number[] }>;
};
let framesOnDisk: Record<string, number>;

vi.mock("@talmolab/sleap-io.js", () => ({
  ExportCancelled,
  saveSlpStructureToBytes: async () => new Uint8Array(10),
  buildSerializableEmbedPlan: async (_l: unknown, _e: unknown, source: string, opts: object) => {
    calls.push(`plan(${JSON.stringify(source)},${JSON.stringify(opts)})`);
    return plan;
  },
  appendEncodedVideos: async (
    _writer: unknown,
    _labels: unknown,
    entries: unknown[],
    opts: { onProgress?: (c: number, t: number) => unknown; frameReader?: unknown }
  ) => {
    calls.push(`appendEncodedVideos(${entries.length})`);
    if (opts.frameReader) calls.push("frameReader");
    await appendImpl(opts);
  },
  StreamingH5Writer: class {
    async openWrite(_sink: unknown, path: string) {
      calls.push(`openWrite(${path.split("/").pop()})`);
    }
    async openAppend() {
      calls.push("openAppend");
    }
    async appendEmbeddedVideos() {
      calls.push("appendEmbeddedVideos");
      return copyImpl();
    }
    async close() {
      calls.push("writer.close");
      await closeImpl();
    }
  },
  StreamingH5File: class {
    async openRange() {
      calls.push("verify");
    }
    async getDatasetMeta(path: string) {
      return { shape: [framesOnDisk[path] ?? 0] };
    }
    async close() {}
  },
}));
vi.mock("@/lib/nativeWrite", () => ({
  withNativeWriteHandle: <T,>(work: () => Promise<T>) => work(),
  writeOpen: async (p: string) => void files.set(p, 0),
  writeOpenAppend: async () => {},
  writeAt: async () => {},
  readAt: async () => new Uint8Array(0),
  truncateFile: async () => {},
  writeClose: async () => {
    calls.push("native.close");
  },
  renameFile: async (from: string, to: string) => {
    calls.push("rename");
    files.set(to, files.get(from) ?? 0);
    files.delete(from);
  },
  copyFile: async (from: string, to: string) => {
    calls.push("copy");
    files.set(to, files.get(from) ?? 0);
  },
  removeFile: async (p: string) => {
    calls.push(`remove(${p.split("/").pop()})`);
    files.delete(p);
  },
}));
vi.mock("@/lib/nativeRange", () => ({
  fileSize: async () => 10,
  readRange: async () => new Uint8Array(0),
}));
const stagingDir = (dir: string) => async () => {
  if (!stagingDirExists) throw new Error("no such directory");
  return dir;
};
vi.mock("@tauri-apps/api/path", () => ({
  appCacheDir: stagingDir("/cache"),
  appLocalDataDir: stagingDir("/local"),
  join: async (...parts: string[]) => parts.join("/"),
}));

const { saveEmbeddedPkgStreaming } = await import("@/lib/saveEmbeddedPkgStreaming");

const labels = {} as never;

beforeEach(() => {
  calls.length = 0;
  files.clear();
  (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated = true;
  plan = { sourcePath: "", entries: [], encodeEntries: [{ videoIndex: 0, frameNumbers: [0, 5, 9] }] };
  framesOnDisk = { "video0/frame_numbers": 3 };
  appendImpl = async () => {};
  copyImpl = async () => ({ success: true });
  closeImpl = async () => {};
  stagingDirExists = true;
});

describe("saveEmbeddedPkgStreaming — new embed (no source file)", () => {
  it("opens the stage file alone, streams the frames in, verifies them, and publishes", async () => {
    const progress: number[] = [];
    appendImpl = async (opts) => {
      for (let i = 1; i <= 3; i++) opts.onProgress?.(i, 3);
    };
    await saveEmbeddedPkgStreaming(labels, "/out/x.pkg.slp", null, {
      embed: "user",
      onProgress: (c) => void progress.push(c),
    });

    expect(calls.find((c) => c.startsWith("plan("))).toBe('plan("",{"allowEncode":true})');
    expect(calls).toContain("appendEncodedVideos(1)");
    expect(calls).not.toContain("openAppend");
    expect(calls.find((c) => c.startsWith("openWrite"))).toBeDefined();
    expect(progress).toEqual([1, 2, 3]);
    // Published only after the frames went in: bulk copy, then atomic rename.
    expect(calls.indexOf("appendEncodedVideos(1)")).toBeLessThan(calls.indexOf("copy"));
    expect(calls.indexOf("copy")).toBeLessThan(calls.indexOf("rename"));
    expect(files.has("/out/x.pkg.slp")).toBe(true);
  });

  it("hands a frame reader (desktop: ffmpeg) through to io", async () => {
    await saveEmbeddedPkgStreaming(labels, "/out/x.pkg.slp", null, {
      embed: "user",
      frameReader: async () => null,
    });
    expect(calls).toContain("frameReader");
  });

  it("refuses to publish when the file holds fewer frames than planned", async () => {
    framesOnDisk = { "video0/frame_numbers": 2 };
    await expect(
      saveEmbeddedPkgStreaming(labels, "/out/x.pkg.slp", null, { embed: "user" })
    ).rejects.toThrow("expected 3");
    expect(calls).not.toContain("rename");
    expect(files.has("/out/x.pkg.slp")).toBe(false);
  });

  it("removes the partial file and writes nothing when cancelled", async () => {
    appendImpl = async () => {
      throw new ExportCancelled();
    };
    await expect(
      saveEmbeddedPkgStreaming(labels, "/out/x.pkg.slp", null, { embed: "user" })
    ).rejects.toBeInstanceOf(ExportCancelled);
    expect(calls).toContain("writer.close");
    expect(calls).not.toContain("rename");
    expect([...files.keys()]).toEqual([]);
  });

  it("needs the source file to copy already-embedded images", async () => {
    plan = { sourcePath: "", entries: [{ videoIndex: 0, frameNumbers: [1] }], encodeEntries: [] };
    await expect(
      saveEmbeddedPkgStreaming(labels, "/out/x.pkg.slp", null, { embed: "user" })
    ).rejects.toThrow("needs the source file");
  });
});

const DEST = "/out/x.pkg.slp";
const WRITE_FAILED = "Could not write 96 bytes at offset 0 of the file.";

const failedClose = async () => {
  throw new Error(WRITE_FAILED);
};

/** How many times the writer was closed: asking twice would never be answered. */
const writerCloses = () => calls.filter((c) => c === "writer.close").length;

/** The writer's close and whatever ran straight after it. */
const afterWriterClose = () => calls.slice(calls.indexOf("writer.close"), calls.indexOf("writer.close") + 2);

const routes = [
  {
    name: "embedding new frames",
    source: null,
    setPlan: () => {
      plan = { sourcePath: "", entries: [], encodeEntries: [{ videoIndex: 0, frameNumbers: [0, 5, 9] }] };
    },
    failStep: () => {
      appendImpl = async () => {
        throw new Error("could not read a frame");
      };
    },
    stepError: "could not read a frame",
  },
  {
    name: "copying stored images",
    source: "/in/x.pkg.slp",
    setPlan: () => {
      plan = { sourcePath: "/in/x.pkg.slp", entries: [{ videoIndex: 0, frameNumbers: [0, 5, 9] }], encodeEntries: [] };
    },
    failStep: () => {
      copyImpl = async () => ({ success: false, error: "could not read the source" });
    },
    stepError: "could not read the source",
  },
];

for (const route of routes) {
  describe(`saveEmbeddedPkgStreaming — closing the writer, ${route.name}`, () => {
    beforeEach(() => route.setPlan());

    it("a healthy save closes the writer and the native handle, then verifies and publishes", async () => {
      await saveEmbeddedPkgStreaming(labels, DEST, route.source);

      expect(writerCloses()).toBe(1);
      const from = calls.indexOf("writer.close");
      expect(calls.slice(from, from + 5)).toEqual(["writer.close", "native.close", "verify", "copy", "rename"]);
      expect(files.has(DEST)).toBe(true);
    });

    it("a rejected close fails the save, publishes nothing and removes the stage", async () => {
      files.set(DEST, 123); // the project already at the destination
      closeImpl = failedClose;

      await expect(saveEmbeddedPkgStreaming(labels, DEST, route.source)).rejects.toThrow(WRITE_FAILED);

      expect(calls).not.toContain("verify");
      expect(calls).not.toContain("copy");
      expect(calls).not.toContain("rename");
      expect([...files]).toEqual([[DEST, 123]]);
    });

    it("a rejected close still closes the native handle, and the writer only once", async () => {
      closeImpl = failedClose;
      await expect(saveEmbeddedPkgStreaming(labels, DEST, route.source)).rejects.toThrow(WRITE_FAILED);

      expect(writerCloses()).toBe(1);
      expect(afterWriterClose()).toEqual(["writer.close", "native.close"]);
    });

    it("a rejected close of a stage beside the destination removes that stage", async () => {
      stagingDirExists = false;
      closeImpl = failedClose;

      await expect(saveEmbeddedPkgStreaming(labels, DEST, route.source)).rejects.toThrow(WRITE_FAILED);

      expect(calls).not.toContain("rename");
      expect(calls.some((c) => c.startsWith("remove(x.pkg.slp.sleap-tmp-"))).toBe(true);
      expect([...files.keys()]).toEqual([]);
    });

    it("an earlier error stays the one thrown when the close rejects too", async () => {
      route.failStep();
      closeImpl = failedClose;

      await expect(saveEmbeddedPkgStreaming(labels, DEST, route.source)).rejects.toThrow(route.stepError);

      expect(writerCloses()).toBe(1);
      expect(afterWriterClose()).toEqual(["writer.close", "native.close"]);
      expect(calls).not.toContain("rename");
      expect([...files.keys()]).toEqual([]);
    });

    it("a close that runs out of space on the local stage retries beside the destination", async () => {
      let closes = 0;
      closeImpl = async () => {
        if (++closes === 1) throw new Error("No space left on device (os error 28)");
      };

      await saveEmbeddedPkgStreaming(labels, DEST, route.source);

      expect(writerCloses()).toBe(2);
      expect(calls).not.toContain("copy");
      expect(calls.filter((c) => c === "rename")).toHaveLength(1);
      expect([...files.keys()]).toEqual([DEST]);
    });
  });
}

describe("saveEmbeddedPkgStreaming — cancelling", () => {
  it("is still a cancel, not a failure, when the close rejects too", async () => {
    appendImpl = async () => {
      throw new ExportCancelled();
    };
    closeImpl = failedClose;

    await expect(saveEmbeddedPkgStreaming(labels, DEST, null, { embed: "user" })).rejects.toBeInstanceOf(
      ExportCancelled
    );

    expect(calls).not.toContain("rename");
    expect([...files.keys()]).toEqual([]);
  });
});
