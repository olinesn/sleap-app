/**
 * A file too new for this version of the app: what the person using it is told,
 * on every way of opening a project. sleap-io.js refuses such a file with an error
 * named `UnsupportedSlpFormatError`; its message is for developers, so these tests
 * give the error a developer's message and check it never reaches the screen.
 * The reader is mocked (template: loadProjectFromUrl.test.ts), because the version
 * of sleap-io.js this app pins may not refuse anything yet.
 */
import { describe, it, expect, beforeEach, vi } from "../bun-test";

vi.mock("@/lib/notify", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/resolveVideos", () => ({
  resolveExternalVideos: vi.fn(async () => {}),
}));

const DEVELOPER_MESSAGE =
  "mice.slp uses SLP format 3.0, which is newer than this version of sleap-io.js " +
  "supports (max 2.x). Upgrade sleap-io.js to read it.";
const refusal = (formatId: unknown = 3) =>
  Object.assign(new Error(DEVELOPER_MESSAGE), {
    name: "UnsupportedSlpFormatError",
    formatId,
  });

class RemoteIOError extends Error {}
const loadSlpMock = vi.fn(async (_source: unknown, _options: unknown) => {
  throw refusal();
});
const readSlpStreamingMock = vi.fn(
  async (_source: unknown, _options: unknown) => {
    throw refusal();
  }
);
vi.mock("@talmolab/sleap-io.js", () => ({
  loadSlp: loadSlpMock,
  readSlpStreaming: readSlpStreamingMock,
  setImageBytesReader: vi.fn(),
  RemoteIOError,
  redactUrl: (u: string) => u,
  redactedCauseSummary: (e: unknown) => `Summary: ${String(e)}`,
}));

import {
  loadProjectFromFile,
  loadProjectFromPath,
  loadProjectFromUrl,
} from "@/lib/loadProject";
import {
  loadErrorText,
  showTooNewFileToast,
  tooNewFileMessage,
} from "@/lib/tooNewFile";
import { useAppStore } from "@/stores/appStore";
import { toast } from "@/lib/notify";

type Mocked = { mock: { calls: unknown[][] }; mockClear: () => void };
const toastError = toast.error as unknown as Mocked;

const expectTooNewToast = (filename: string) => {
  expect(toastError.mock.calls).toHaveLength(1);
  const [title, options] = toastError.mock.calls[0] as [
    string,
    { description: string; duration: number },
  ];
  expect(title).toBe("Can't open this file");
  expect(options.description).toBe(String(tooNewFileMessage(refusal(), filename)));
  expect(options.description).not.toContain("sleap-io.js");
  expect(options.duration).toBe(Infinity);
};

describe("tooNewFileMessage", () => {
  it("says the file is too new, what format it is and what to do", () => {
    expect(tooNewFileMessage(refusal(), "mice.slp")).toBe(
      "mice.slp was made by a newer version of SLEAP (SLP format 3.0), and this " +
        "version can't open it. Update SLEAP if a newer version is available, or " +
        "re-save the file from Python sleap-io with legacy_format=True."
    );
  });

  it("does not name a library the person using the app has not heard of", () => {
    expect(tooNewFileMessage(refusal())).not.toContain("sleap-io.js");
  });

  it("shows the format as a version, whole or not", () => {
    expect(tooNewFileMessage(refusal(4))).toContain("(SLP format 4.0)");
    expect(tooNewFileMessage(refusal(3.1))).toContain("(SLP format 3.1)");
  });

  it("leaves the format out rather than print something odd", () => {
    expect(tooNewFileMessage(refusal(null))).toContain(
      "newer version of SLEAP, and this"
    );
  });

  it("says 'This file' with no name", () => {
    expect(tooNewFileMessage(refusal())).toStartWith("This file was made by");
    expect(tooNewFileMessage(refusal(), "")).toStartWith("This file was made by");
  });

  it("is null for any other failure", () => {
    for (const err of [new Error("corrupt"), "text", null, undefined, {}]) {
      expect(tooNewFileMessage(err)).toBeNull();
    }
    // The name decides, not the words.
    expect(tooNewFileMessage(new Error(DEVELOPER_MESSAGE))).toBeNull();
  });
});

describe("loadErrorText", () => {
  it("gives the too-new message, or the error's own", () => {
    expect(loadErrorText(refusal())).toBe(String(tooNewFileMessage(refusal())));
    expect(loadErrorText(new Error("corrupt"))).toBe("corrupt");
    expect(loadErrorText("text")).toBe("text");
  });
});

describe("opening a project with a file too new to read", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    toastError.mockClear();
    loadSlpMock.mockClear();
    readSlpStreamingMock.mockClear();
    loadSlpMock.mockImplementation(async () => {
      throw refusal();
    });
    readSlpStreamingMock.mockImplementation(async () => {
      throw refusal();
    });
  });

  const expectNothingOpened = () => {
    expect(useAppStore.getState().labels).toBeFalsy();
    expect(useAppStore.getState().isLoading).toBe(false);
  };

  it("loadProjectFromFile, the browser's Open", async () => {
    const file = new File([new Uint8Array(4)], "mice.slp");
    expect(await loadProjectFromFile(file)).toBe(false);
    expectTooNewToast("mice.slp");
    expectNothingOpened();
  });

  it("loadProjectFromPath, the desktop app's Open", async () => {
    const ok = await loadProjectFromPath(
      "/data/rec/mice.slp",
      async () => new Uint8Array(4)
    );
    expect(ok).toBe(false);
    expectTooNewToast("mice.slp");
    expectNothingOpened();
  });

  it("loadProjectFromUrl, an Open in SLEAP link", async () => {
    const ok = await loadProjectFromUrl(
      "https://share.sleap.ai/d/mice.slp?token=abc"
    );
    expect(ok).toBe(false);
    expectTooNewToast("mice.slp");
    expectNothingOpened();
  });

  it("any other failure keeps its usual toast", async () => {
    loadSlpMock.mockImplementation(async () => {
      throw new Error("corrupt file");
    });
    const file = new File([new Uint8Array(4)], "mice.slp");
    expect(await loadProjectFromFile(file)).toBe(false);
    expect(toastError.mock.calls[0]).toEqual([
      "Failed to load project",
      { description: "corrupt file" },
    ]);
  });

  it("showTooNewFileToast shows nothing for any other failure", () => {
    expect(showTooNewFileToast(new Error("corrupt"))).toBe(false);
    expect(toastError.mock.calls).toHaveLength(0);
  });
});
