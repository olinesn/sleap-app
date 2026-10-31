/**
 * Browser Export Labels Package through OPFS (`exportNewPkgOpfs`): the
 * structure seeds an OPFS file, the writer's worker appends the frames
 * (io `appendEncodedVideos`), and the finished file is streamed into the
 * picked file. Also Save As of an already-embedded package
 * (`saveEmbeddedPkgOpfs`), which copies the stored images the same way. Closing
 * the writer writes the last of the file, so a failed close fails both.
 * io's writer and the browser's OPFS are faked.
 */
import { describe, it, expect, beforeEach, vi } from "../bun-test";

class ExportCancelled extends Error {}

const calls: string[] = [];
let appendImpl: (opts: { onProgress?: (c: number, t: number) => unknown }) => Promise<void>;
let encodeEntries: unknown[];
let copyEntries: unknown[];
let openCopyImpl: () => Promise<void>;
let copyImpl: (
  onProgress?: (done: number, total: number) => void
) => Promise<{ success: boolean; error?: string }>;
let closeImpl: () => Promise<void>;
/** How many more times the browser refuses to remove a file, and how. */
let removeRefusals: number;
let removeRefusal: string;

vi.mock("@talmolab/sleap-io.js", () => ({
  saveSlpStructureToBytes: async (_l: unknown, opts: { embed: unknown }) => {
    calls.push(`structure(${JSON.stringify(opts.embed)})`);
    return new Uint8Array([1, 2, 3]);
  },
  buildSerializableEmbedPlan: async (_l: unknown, embed: unknown, _s: string, opts: object) => {
    calls.push(`plan(${JSON.stringify(embed)},${JSON.stringify(opts)})`);
    return { sourcePath: "", entries: copyEntries, encodeEntries };
  },
  appendEncodedVideos: async (
    _w: unknown,
    _l: unknown,
    entries: unknown[],
    opts: { onProgress?: (c: number, t: number) => unknown }
  ) => {
    calls.push(`append(${entries.length})`);
    await appendImpl(opts);
  },
  StreamingH5Writer: class {
    async openWriteOpfs(path: string, size: number) {
      calls.push(`openWriteOpfs(${size})`);
      expect(opfsFiles.get(path)).toEqual(new Uint8Array([1, 2, 3]));
    }
    async openAppendOpfs(path: string, _source: unknown, structure: Uint8Array) {
      calls.push("openAppendOpfs");
      opfsFiles.set(path, structure); // the worker seeds the file before copying into it
      await openCopyImpl();
    }
    async appendEmbeddedVideos(
      entries: unknown[],
      onProgress?: (done: number, total: number) => void
    ) {
      calls.push(`copy(${entries.length})`);
      return copyImpl(onProgress);
    }
    async close() {
      calls.push("writer.close");
      await closeImpl();
    }
  },
}));

/** The picked file's writable, as far as the export uses it. */
interface FakeWritable {
  write(b: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/**
 * A File-like whose stream() pipes its bytes into the (fake) writable; the
 * test DOM has no WritableStream that bun's native pipeTo accepts.
 */
function fakeFile(bytes: Uint8Array) {
  return {
    size: bytes.length,
    stream: () => ({
      pipeTo: async (w: FakeWritable) => {
        await w.write(bytes);
        await w.close();
      },
    }),
  };
}

/** Fake OPFS root: files by name. */
const opfsFiles = new Map<string, Uint8Array>();
const root = {
  getFileHandle: async (name: string, opts?: { create?: boolean }) => {
    if (!opfsFiles.has(name)) {
      if (!opts?.create) throw new DOMException("missing", "NotFoundError");
      opfsFiles.set(name, new Uint8Array(0));
    }
    return {
      createWritable: async () => ({
        write: async (b: Uint8Array) => void opfsFiles.set(name, new Uint8Array(b)),
        close: async () => {},
      }),
      getFile: async () => fakeFile(opfsFiles.get(name)!),
    };
  },
  removeEntry: async (name: string) => {
    if (removeRefusals > 0) {
      removeRefusals -= 1;
      calls.push("removeRefused");
      throw new DOMException("the worker still holds it", removeRefusal);
    }
    calls.push("removeStaging");
    opfsFiles.delete(name);
  },
};
Object.defineProperty(globalThis.navigator, "storage", {
  value: { getDirectory: async () => root },
  configurable: true,
});

/** The picked destination: what it holds, and whether it was removed. */
function destHandle(initial = new Uint8Array(0)) {
  const dest = {
    name: "out.pkg.slp",
    bytes: initial,
    removed: false,
    getFile: async () => fakeFile(dest.bytes),
    remove: async () => void (dest.removed = true),
    createWritable: async (): Promise<FakeWritable> => {
      const chunks: Uint8Array[] = [];
      return {
        write: async (c) => void chunks.push(c),
        close: async () => {
          dest.bytes = new Uint8Array(chunks.flatMap((c) => [...c]));
          calls.push("published");
        },
      };
    },
  };
  return dest;
}

const { exportNewPkgOpfs, saveEmbeddedPkgOpfs } = await import("@/lib/saveEmbeddedPkgOpfs");
const labels = {} as never;

const WRITE_FAILED = "Could not write 96 bytes at offset 0 of the file.";
const failedClose = async () => {
  throw new Error(WRITE_FAILED);
};
/** How many times the writer was closed: asking twice would never be answered. */
const writerCloses = () => calls.filter((c) => c === "writer.close").length;

beforeEach(() => {
  calls.length = 0;
  opfsFiles.clear();
  encodeEntries = [{ videoIndex: 0, frameNumbers: [0, 5] }];
  copyEntries = [];
  appendImpl = async () => {};
  openCopyImpl = async () => {};
  copyImpl = async () => ({ success: true });
  closeImpl = async () => {};
  removeRefusals = 0;
  removeRefusal = "NoModificationAllowedError";
});

describe("exportNewPkgOpfs", () => {
  it("seeds the structure, appends the frames in the worker, then streams it into the picked file", async () => {
    const progress: number[] = [];
    appendImpl = async (opts) => {
      for (let i = 1; i <= 2; i++) opts.onProgress?.(i, 2);
    };
    const dest = destHandle();
    const name = await exportNewPkgOpfs(labels, dest as never, {
      embed: "user",
      onProgress: (c) => void progress.push(c),
    });

    expect(name).toBe("out.pkg.slp");
    expect(calls).toEqual([
      'structure("user")',
      'plan("user",{"allowEncode":true})',
      "openWriteOpfs(3)",
      "append(1)",
      "writer.close",
      "published",
      "removeStaging",
    ]);
    expect(progress).toEqual([1, 2]);
    expect(dest.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(opfsFiles.size).toBe(0);
  });

  it("publishes the structure alone when no video has frames to embed", async () => {
    encodeEntries = [];
    const dest = destHandle();
    await exportNewPkgOpfs(labels, dest as never, { embed: "user" });
    expect(calls).not.toContain("openWriteOpfs(3)");
    expect(dest.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("on cancel, removes the staging file and the empty picked file, and writes nothing", async () => {
    appendImpl = async () => {
      throw new ExportCancelled();
    };
    const dest = destHandle();
    await expect(
      exportNewPkgOpfs(labels, dest as never, { embed: "user" })
    ).rejects.toBeInstanceOf(ExportCancelled);
    expect(calls).toContain("writer.close");
    expect(calls).not.toContain("published");
    expect(opfsFiles.size).toBe(0);
    expect(dest.removed).toBe(true);
  });

  it("never removes a picked file that already had content", async () => {
    appendImpl = async () => {
      throw new Error("disk full");
    };
    const dest = destHandle(new Uint8Array([9]));
    await expect(exportNewPkgOpfs(labels, dest as never, { embed: "user" })).rejects.toThrow(
      "disk full"
    );
    expect(dest.removed).toBe(false);
    expect(dest.bytes).toEqual(new Uint8Array([9]));
  });

  it("a rejected close fails the export, publishes nothing, and cleans up like any failure", async () => {
    closeImpl = failedClose;
    const dest = destHandle();
    await expect(exportNewPkgOpfs(labels, dest as never, { embed: "user" })).rejects.toThrow(
      WRITE_FAILED
    );
    expect(writerCloses()).toBe(1);
    expect(calls).not.toContain("published");
    expect(opfsFiles.size).toBe(0);
    expect(dest.removed).toBe(true);
  });

  it("a rejected close never touches a picked file that already had content", async () => {
    closeImpl = failedClose;
    const dest = destHandle(new Uint8Array([9]));
    await expect(exportNewPkgOpfs(labels, dest as never, { embed: "user" })).rejects.toThrow(
      WRITE_FAILED
    );
    expect(dest.removed).toBe(false);
    expect(dest.bytes).toEqual(new Uint8Array([9]));
  });

  it("an earlier error stays the one thrown when the close rejects too", async () => {
    appendImpl = async () => {
      throw new Error("disk full");
    };
    closeImpl = failedClose;
    const dest = destHandle();
    await expect(exportNewPkgOpfs(labels, dest as never, { embed: "user" })).rejects.toThrow(
      "disk full"
    );
    expect(writerCloses()).toBe(1);
    expect(calls).not.toContain("published");
    expect(opfsFiles.size).toBe(0);
  });

  it("a cancel is still a cancel when the close rejects too", async () => {
    appendImpl = async () => {
      throw new ExportCancelled();
    };
    closeImpl = failedClose;
    await expect(
      exportNewPkgOpfs(labels, destHandle() as never, { embed: "user" })
    ).rejects.toBeInstanceOf(ExportCancelled);
  });
});

describe("saveEmbeddedPkgOpfs", () => {
  const source = { name: "open.pkg.slp" } as never;

  beforeEach(() => {
    encodeEntries = [];
    copyEntries = [{ videoIndex: 0, frameNumbers: [0, 5] }];
  });

  it("seeds the structure, copies the images in the worker, then streams it into the picked file", async () => {
    const progress: number[] = [];
    copyImpl = async (onProgress) => {
      onProgress?.(2, 2);
      return { success: true };
    };
    const dest = destHandle();
    const name = await saveEmbeddedPkgOpfs(labels, source, dest as never, (done) => {
      progress.push(done);
    });

    expect(name).toBe("out.pkg.slp");
    expect(calls).toEqual([
      "structure(false)",
      "plan(false,undefined)",
      "openAppendOpfs",
      "copy(1)",
      "writer.close",
      "published",
      "removeStaging",
    ]);
    expect(progress).toEqual([2]);
    expect(dest.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(dest.removed).toBe(false);
    expect(opfsFiles.size).toBe(0);
  });

  it("a rejected close fails the save, publishes nothing, and removes the staging file", async () => {
    closeImpl = failedClose;
    const dest = destHandle();
    await expect(saveEmbeddedPkgOpfs(labels, source, dest as never)).rejects.toThrow(WRITE_FAILED);
    expect(writerCloses()).toBe(1);
    expect(calls).not.toContain("published");
    expect(opfsFiles.size).toBe(0);
    expect(dest.removed).toBe(true);
  });

  it("a rejected close never touches a picked file that already had content", async () => {
    closeImpl = failedClose;
    const dest = destHandle(new Uint8Array([9]));
    await expect(saveEmbeddedPkgOpfs(labels, source, dest as never)).rejects.toThrow(WRITE_FAILED);
    expect(dest.removed).toBe(false);
    expect(dest.bytes).toEqual(new Uint8Array([9]));
  });

  it("a rejected close fails a save with no images to copy too", async () => {
    copyEntries = [];
    closeImpl = failedClose;
    await expect(saveEmbeddedPkgOpfs(labels, source, destHandle() as never)).rejects.toThrow(
      WRITE_FAILED
    );
    expect(calls).not.toContain("published");
    expect(opfsFiles.size).toBe(0);
  });

  it("an error reported by the copy stays the one thrown when the close rejects too", async () => {
    copyImpl = async () => ({ success: false, error: "could not read the source" });
    closeImpl = failedClose;
    const dest = destHandle();
    await expect(saveEmbeddedPkgOpfs(labels, source, dest as never)).rejects.toThrow(
      "could not read the source"
    );
    expect(writerCloses()).toBe(1);
    expect(calls).not.toContain("published");
    expect(opfsFiles.size).toBe(0);
    expect(dest.removed).toBe(true);
  });

  it("a failure to open stays the one thrown when the close rejects too", async () => {
    openCopyImpl = async () => {
      throw new Error("could not open the staging file");
    };
    closeImpl = failedClose;
    await expect(saveEmbeddedPkgOpfs(labels, source, destHandle() as never)).rejects.toThrow(
      "could not open the staging file"
    );
    expect(writerCloses()).toBe(1);
    expect(calls).not.toContain("published");
    expect(opfsFiles.size).toBe(0);
  });

  it("waits for the browser to let go of the staging file after a failed save", async () => {
    copyImpl = async () => ({ success: false, error: "could not read the source" });
    removeRefusals = 2;
    await expect(saveEmbeddedPkgOpfs(labels, source, destHandle() as never)).rejects.toThrow(
      "could not read the source"
    );
    expect(calls.filter((c) => c === "removeRefused")).toHaveLength(2);
    expect(opfsFiles.size).toBe(0);
  });

  it("only waits on a locked file", async () => {
    copyImpl = async () => ({ success: false, error: "could not read the source" });
    removeRefusals = 1;
    removeRefusal = "NotFoundError";
    await expect(saveEmbeddedPkgOpfs(labels, source, destHandle() as never)).rejects.toThrow(
      "could not read the source"
    );
    expect(calls.filter((c) => c === "removeRefused")).toHaveLength(1);
    expect(calls).not.toContain("removeStaging");
  });

  it("gives up on a file that stays locked, and the save's own error still comes through", async () => {
    copyImpl = async () => ({ success: false, error: "could not read the source" });
    removeRefusals = Infinity;
    vi.stubGlobal("setTimeout", (done: () => void) => {
      done();
      return 0;
    });
    try {
      await expect(saveEmbeddedPkgOpfs(labels, source, destHandle() as never)).rejects.toThrow(
        "could not read the source"
      );
    } finally {
      vi.unstubAllGlobals();
    }
    expect(calls.filter((c) => c === "removeRefused")).toHaveLength(101);
    expect(opfsFiles.size).toBe(1);
  });
});
