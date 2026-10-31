/**
 * Videos stored as links: a public link re-streams on reload, and a link a save
 * masked (`?token=***`) asks to be pasted again.
 *
 * Opening a real link needs a server and a decoder, so `createVideoBackend` is
 * replaced here by one that says which links open; these cover every decision
 * around it. Nothing here depends on the installed sleap-io.js masking on save: a
 * link it masked is only a string to the app, and the app goes by the mask alone.
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from "../bun-test";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Labels, Skeleton, Video } from "@talmolab/sleap-io.js";

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};
vi.mock("sonner", () => ({ toast }));

const realIo = await import("@talmolab/sleap-io.js");
/** Links that open; anything else is refused the way a server refuses a bad token. */
const opensOk = new Set<string>();
const opened: string[] = [];
const createVideoBackend = vi.fn(async (url: string) => {
  opened.push(url);
  if (!opensOk.has(url)) {
    throw new Error("HTTP 401; status=401; url=https://x.test/v.mp4?token=***");
  }
  return {
    filename: url,
    shape: [120, 240, 320, 3],
    fps: 30,
    getFrame: async () => ({}),
  };
});
vi.mock("@talmolab/sleap-io.js", () => ({ ...realIo, createVideoBackend }));

/** How many times a located file's size was asked for: once per open. */
const fileSize = vi.fn(async () => {
  throw new Error("no such file");
});
vi.mock("@/lib/nativeRange", () => ({ fileSize, readRange: vi.fn() }));

const {
  isMaskedVideoUrl,
  urlHoldsCredential,
  savedLinkName,
  sameLinkOnceSaved,
  isVideoMissing,
  videoIssue,
  ensureVideoBackend,
  assignVideoBackendFromUrl,
  addVideoUrlToLabels,
  resolveVideoFromUrl,
  resolveExternalVideos,
  getBasename,
} = await import("@/lib/resolveVideos");
const { useAppStore } = await import("@/stores/appStore");
const { videoBasename } = await import("@/lib/videoFilter");
const { dirtyFrameTracker } = await import("@/lib/autosaveDirty");

const MASKED = "https://x.test/v.mp4?token=***";
const WHOLE = "https://x.test/v.mp4?token=abc123";
const PUBLIC = "https://x.test/v.mp4";

beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => {
  opensOk.clear();
  opened.length = 0;
  createVideoBackend.mockClear();
  fileSize.mockClear();
  for (const fn of Object.values(toast)) fn.mockClear();
  useAppStore.setState(useAppStore.getInitialState());
  dirtyFrameTracker.clear();
});

/** A closed video, as the streaming `.slp` reader leaves every external one. */
function closedVideo(filename: string | string[]): Video {
  return new Video({
    filename,
    backendMetadata: { shape: [120, 240, 320, 3] },
    openBackend: false,
  });
}

function loadProjectWith(...videos: Video[]): Labels {
  const skeleton = new Skeleton({ nodes: ["a"], name: "test" });
  const labels = new Labels({ videos, skeletons: [skeleton] });
  labels.reindex();
  useAppStore.getState().setLabels(labels, "test.slp");
  return labels;
}

describe("isMaskedVideoUrl", () => {
  it.each([
    [MASKED],
    ["http://x.test/v.mp4?token=***"],
    ["HTTPS://x.test/v.mp4?token=***"],
    // Anywhere in the query, under any name: sleap-io.js's list isn't repeated here.
    ["https://x.test/v.mp4?a=1&token=***&b=2"],
    [
      "https://x.test/v.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=***&X-Amz-Date=20261031T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=***",
    ],
    ["https://x.test/get.mp4?key=***"],
    ["https://x.test/v.mp4#token=***"],
    // A password, in the two forms sleap-io.js writes.
    ["https://***:***@x.test/v.mp4"],
    ["https://***:***@x.test:notaport/v.mp4"],
    // Python percent-encodes its mask.
    ["https://x.test/v.mp4?token=%2A%2A%2A"],
    ["https://x.test/v.mp4?token=%2a%2a%2a&b=2"],
  ])("%s is masked", (url) => {
    expect(isMaskedVideoUrl(url)).toBe(true);
  });

  it.each([
    [PUBLIC],
    [WHOLE],
    ["https://me:pw@x.test/v.mp4"],
    // Asterisks that aren't the mask.
    ["https://x.test/v.mp4?q=a***"],
    ["https://x.test/v.mp4?q=***a"],
    ["https://x.test/***.mp4"],
    ["https://x.test/v.mp4?q=**"],
    // Not an http(s) link: a plain missing file, as it was.
    ["/data/v.mp4?token=***"],
    ["v.mp4?token=***"],
    ["s3://bucket/v.mp4?token=***"],
    [""],
  ])("%s is not masked", (url) => {
    expect(isMaskedVideoUrl(url)).toBe(false);
  });

  it("an image sequence is not a masked link", () => {
    expect(isMaskedVideoUrl(["https://x.test/0.png?token=***"])).toBe(false);
  });
});

describe("urlHoldsCredential", () => {
  it("follows the library's list", () => {
    expect(urlHoldsCredential(WHOLE)).toBe(true);
    expect(urlHoldsCredential("https://me:pw@x.test/v.mp4")).toBe(true);
    expect(urlHoldsCredential("https://x.test/v.mp4?frame=1&quality=high")).toBe(false);
    expect(urlHoldsCredential(PUBLIC)).toBe(false);
  });

  it("a URL that doesn't normalize the same isn't called a credential", () => {
    expect(urlHoldsCredential("https://x.test")).toBe(false);
    expect(urlHoldsCredential("https://x.test/a b.mp4")).toBe(false);
  });

  it("no answer for what isn't a URL", () => {
    expect(urlHoldsCredential("")).toBe(false);
    expect(urlHoldsCredential("not a url")).toBe(false);
  });
});

describe("savedLinkName", () => {
  it("masks a credential, as a save would", () => {
    expect(savedLinkName(WHOLE)).toBe(MASKED);
    expect(savedLinkName("https://x.test/v.mp4?a=1&token=abc123&b=2")).toBe(
      "https://x.test/v.mp4?a=1&token=***&b=2",
    );
    expect(savedLinkName("https://me:pw@x.test/v.mp4")).toBe("https://***:***@x.test/v.mp4");
  });

  it("leaves anything else as given, even what a URL parser would rewrite", () => {
    for (const url of [PUBLIC, "https://x.test/a b.mp4", "https://x.test/v.mp4?q=a+b&r=1", MASKED]) {
      expect(savedLinkName(url)).toBe(url);
    }
  });
});

describe("sameLinkOnceSaved", () => {
  it("a new credential for the same link saves the same", () => {
    expect(sameLinkOnceSaved(MASKED, WHOLE)).toBe(true);
    expect(sameLinkOnceSaved("https://x.test/v.mp4?token=%2A%2A%2A", WHOLE)).toBe(true);
  });

  it("anything else about the link saves differently", () => {
    expect(sameLinkOnceSaved(MASKED, "https://y.test/v.mp4?token=abc123")).toBe(false);
    expect(sameLinkOnceSaved(MASKED, "https://x.test/moved/v.mp4?token=abc123")).toBe(false);
    expect(sameLinkOnceSaved(MASKED, PUBLIC)).toBe(false);
    expect(sameLinkOnceSaved(["a.png"], WHOLE)).toBe(false);
  });
});

describe("isVideoMissing / videoIssue for links", () => {
  it("a masked link with no backend is missing, whatever a failed open recorded", () => {
    const video = closedVideo(MASKED);
    expect(isVideoMissing(video)).toBe(true);
    expect(videoIssue(video)).toBe("masked-link");
    video.backendError = { kind: "decode", message: "HTTP 401" };
    expect(videoIssue(video)).toBe("masked-link");
  });

  it("a masked link that opened anyway is present", () => {
    const video = closedVideo(MASKED);
    video.backend = { shape: [1, 1, 1, 1] } as never;
    expect(isVideoMissing(video)).toBe(false);
    expect(videoIssue(video)).toBeNull();
  });

  it("any other link is present, opened or not, as it was", () => {
    for (const url of [PUBLIC, WHOLE]) {
      const video = closedVideo(url);
      expect(isVideoMissing(video)).toBe(false);
      expect(videoIssue(video)).toBeNull();
      video.backendError = { kind: "decode", message: "HTTP 403" };
      expect(isVideoMissing(video)).toBe(false);
      expect(videoIssue(video)).toBeNull();
    }
  });

  it("a file that isn't a link is missing as it was", () => {
    const video = closedVideo("/data/v.mp4?token=***");
    expect(isVideoMissing(video)).toBe(true);
    expect(videoIssue(video)).toBe("missing");
  });
});

describe("ensureVideoBackend for a stored link", () => {
  it("opens a public link on first use", async () => {
    opensOk.add(PUBLIC);
    const video = closedVideo(PUBLIC);
    expect(await ensureVideoBackend(video)).toBe(true);
    expect(video.backend).not.toBeNull();
    expect(video.backendError).toBeNull();
    expect(opened).toEqual([PUBLIC]);
  });

  it("opens a whole link that still holds its token", async () => {
    opensOk.add(WHOLE);
    const video = closedVideo(WHOLE);
    expect(await ensureVideoBackend(video)).toBe(true);
    expect(opened).toEqual([WHOLE]);
  });

  it("doesn't reopen one that's open", async () => {
    opensOk.add(PUBLIC);
    const video = closedVideo(PUBLIC);
    await ensureVideoBackend(video);
    expect(await ensureVideoBackend(video)).toBe(true);
    expect(opened).toEqual([PUBLIC]);
  });

  it("two reads during a slow open share it", async () => {
    opensOk.add(PUBLIC);
    const video = closedVideo(PUBLIC);
    const [a, b] = await Promise.all([ensureVideoBackend(video), ensureVideoBackend(video)]);
    expect([a, b]).toEqual([true, true]);
    expect(opened).toEqual([PUBLIC]);
  });

  it("a read during the open waits for it instead of racing its probe", async () => {
    // An MP4 backend drops all but the newest read, so a frame read on a half-open
    // backend would make the probe fail and the video stay blank until a reload.
    let finishProbe = () => {};
    const probing = new Promise<void>((r) => {
      finishProbe = r;
    });
    let probeRan = false;
    createVideoBackend.mockImplementationOnce(async (url: string) => {
      opened.push(url);
      return {
        filename: url,
        shape: [120, 240, 320, 3],
        fps: 30,
        getFrame: async () => {
          probeRan = true;
          await probing;
          return {};
        },
      };
    });
    const video = closedVideo(PUBLIC);
    const first = ensureVideoBackend(video);
    while (!probeRan) await new Promise((r) => setTimeout(r, 1));
    // What a frame read looks at: no backend yet, so it goes through ensureVideoBackend.
    expect(video.backend).toBeNull();
    const second = ensureVideoBackend(video);
    finishProbe();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(opened).toEqual([PUBLIC]);
    expect(video.backend).not.toBeNull();
  });

  it("a located file isn't opened twice either", async () => {
    // A second open would leave the first backend unclosed, and whichever failed
    // its probe last would blank a video that had opened.
    const video = closedVideo("/proj/v.mp4");
    (video.backendMetadata as Record<string, unknown>).lazyPath = "/proj/v.mp4";
    await Promise.all([ensureVideoBackend(video), ensureVideoBackend(video)]);
    expect(fileSize).toHaveBeenCalledTimes(1);
    expect((video.backendMetadata as Record<string, unknown>).lazyPath).toBeUndefined();
  });

  it("an expired link fails silently, stays not missing, and isn't tried on every read", async () => {
    const video = closedVideo(WHOLE);
    expect(await ensureVideoBackend(video)).toBe(false);
    expect(await ensureVideoBackend(video)).toBe(false);
    expect(await ensureVideoBackend(video)).toBe(false);
    expect(opened).toEqual([WHOLE]);
    expect(video.backend).toBeNull();
    expect(isVideoMissing(video)).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("never requests a masked link", async () => {
    const video = closedVideo(MASKED);
    expect(await ensureVideoBackend(video)).toBe(false);
    expect(opened).toEqual([]);
    expect(video.backendError).toBeNull();
  });

  it("leaves alone what isn't a stored video link", async () => {
    for (const name of [
      "/data/v.mp4",
      "v.mp4",
      "https://x.test/labels.pkg.slp",
      "https://x.test/page",
      "blob:https://x.test/v.mp4",
      ["https://x.test/0.mp4", "https://x.test/1.mp4"],
    ]) {
      expect(await ensureVideoBackend(closedVideo(name))).toBe(false);
    }
    expect(opened).toEqual([]);
  });
});

describe("A link that never answers", () => {
  /** An `.mp4` link answering with a web page: the parser waits for video data forever. */
  function neverAnswers() {
    createVideoBackend.mockImplementationOnce(async (url: string) => ({
      filename: url,
      getFrame: () => new Promise(() => {}),
    }));
  }

  it("fails once the time is up, like any link that doesn't open", async () => {
    neverAnswers();
    const video = closedVideo(MASKED);
    const ok = await assignVideoBackendFromUrl(video, WHOLE, { timeoutMs: 20 });
    expect(ok).toBe(false);
    expect(video.backend).toBeNull();
    expect(video.backendError?.kind).toBe("decode");
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("every link open has the limit", async () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    opensOk.add(PUBLIC);
    await assignVideoBackendFromUrl(closedVideo(PUBLIC), PUBLIC);
    expect(timers.mock.calls.some(([, ms]) => ms === 60_000)).toBe(true);
    timers.mockRestore();
  });

  it("a slower answer within the limit still opens", async () => {
    opensOk.add(PUBLIC);
    const video = closedVideo(PUBLIC);
    expect(await assignVideoBackendFromUrl(video, PUBLIC, { timeoutMs: 5000 })).toBe(true);
    expect(video.backend).not.toBeNull();
  });
});

describe("resolveVideoFromUrl", () => {
  it("the whole link opens the video and goes no further: its name stays the saved form", async () => {
    opensOk.add(WHOLE);
    const video = closedVideo(MASKED);
    expect(await resolveVideoFromUrl(video, WHOLE)).toBe(true);
    expect(opened).toEqual([WHOLE]);
    expect(video.filename).toBe(MASKED);
    expect(video.backend).not.toBeNull();
    expect(isVideoMissing(video)).toBe(false);
    expect(videoIssue(video)).toBeNull();
  });

  it("a different link gives its saved form as the name", async () => {
    const moved = "https://y.test/w.mp4?token=abc123";
    opensOk.add(moved);
    const video = closedVideo(MASKED);
    await resolveVideoFromUrl(video, moved);
    expect(video.filename).toBe("https://y.test/w.mp4?token=***");
  });

  it("a link that fails changes nothing, says so, and the video still asks", async () => {
    const video = closedVideo(MASKED);
    expect(await resolveVideoFromUrl(video, WHOLE)).toBe(false);
    expect(video.filename).toBe(MASKED);
    expect(video.backend).toBeNull();
    expect(videoIssue(video)).toBe("masked-link");
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("a different link that fails doesn't take over the name", async () => {
    const video = closedVideo(MASKED);
    expect(await resolveVideoFromUrl(video, "https://y.test/w.mp4?token=abc123")).toBe(false);
    expect(video.filename).toBe(MASKED);
  });

  it("the failure names the file, not the link's query", async () => {
    await resolveVideoFromUrl(closedVideo(MASKED), WHOLE);
    const [title] = toast.error.mock.calls[0] as unknown as [string];
    expect(title).toBe("Failed to load video: v.mp4");
  });
});

describe("resolveExternalVideos with links", () => {
  let probes = 0;
  const exists = async () => {
    probes++;
    return false;
  };
  const readFile = async () => new Uint8Array();
  beforeEach(() => {
    probes = 0;
  });

  it("says a masked link needs pasting, with no not-found or codec toast", async () => {
    const labels = new Labels({ videos: [closedVideo(MASKED)] });
    await resolveExternalVideos(labels);
    expect(toast.info).toHaveBeenCalledTimes(1);
    const [title] = toast.info.mock.calls[0] as unknown as [string];
    expect(title).toMatch(/^1 video link needs pasting again/);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("counts them", async () => {
    const labels = new Labels({
      videos: [closedVideo(MASKED), closedVideo("https://x.test/w.mp4?sig=***")],
    });
    await resolveExternalVideos(labels);
    const [title] = toast.info.mock.calls[0] as unknown as [string];
    expect(title).toMatch(/^2 video links need pasting again/);
  });

  it("desktop doesn't look for a masked link on disk", async () => {
    const labels = new Labels({ videos: [closedVideo(MASKED)] });
    await resolveExternalVideos(labels, { projectPath: "/proj/a.slp", exists, readFile });
    expect(probes).toBe(0);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a public or expired link gets no toast, and nothing is opened at load", async () => {
    const labels = new Labels({ videos: [closedVideo(PUBLIC), closedVideo(WHOLE)] });
    await resolveExternalVideos(labels);
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
  });

  it("the masked toast comes with a not-found one when both apply", async () => {
    const labels = new Labels({ videos: [closedVideo(MASKED), closedVideo("/gone/v.mp4")] });
    await resolveExternalVideos(labels);
    const titles = toast.info.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(titles.some((t) => /1 video link needs pasting again/.test(t))).toBe(true);
    expect(titles.some((t) => /1 video not found/.test(t))).toBe(true);
  });
});

describe("Names of a masked link", () => {
  it("Locate goes by the file's name, without the mask", () => {
    expect(getBasename(MASKED)).toBe("v.mp4");
    expect(getBasename("https://x.test/a/v.mp4?a=1&sig=***#t=1")).toBe("v.mp4");
    expect(getBasename("https://***:***@x.test/a/v.mp4")).toBe("v.mp4");
  });

  it("other names are unchanged", () => {
    expect(getBasename(WHOLE)).toBe("v.mp4?token=abc123");
    expect(getBasename("/data/v.mp4?token=***")).toBe("v.mp4?token=***");
    expect(getBasename("C:\\videos\\v.mp4")).toBe("v.mp4");
  });

  it("a row shows the file's name, not the end of a long query", () => {
    expect(videoBasename(MASKED)).toBe("v.mp4");
    expect(videoBasename(WHOLE)).toBe("v.mp4");
    expect(videoBasename("https://x.test/a/v.mp4?X-Amz-Signature=***#t=1")).toBe("v.mp4");
    expect(videoBasename(PUBLIC)).toBe("v.mp4");
  });

  it("only a link has a query to drop", () => {
    expect(videoBasename("/data/what?.mp4")).toBe("what?.mp4");
  });
});

/** Whether a key pressed in `input` gets as far as the app's window-level shortcuts. */
function keyReachesShortcuts(input: HTMLElement, init: KeyboardEventInit): boolean {
  let reached = false;
  const listener = () => {
    reached = true;
  };
  window.addEventListener("keydown", listener);
  fireEvent.keyDown(input, init);
  window.removeEventListener("keydown", listener);
  return reached;
}

describe("addVideoUrlToLabels", () => {
  it("a link with a credential opens whole, and is known by its saved form", async () => {
    opensOk.add(WHOLE);
    const labels = new Labels();
    const video = await addVideoUrlToLabels(labels, WHOLE);
    expect(opened).toEqual([WHOLE]);
    expect(video?.filename).toBe(MASKED);
    expect(labels.videos).toEqual([video as Video]);
    expect(isVideoMissing(video as Video)).toBe(false);
  });

  it("a public link is known by itself", async () => {
    const url = "https://x.test/a b.mp4";
    opensOk.add(url);
    const video = await addVideoUrlToLabels(new Labels(), url);
    expect(video?.filename).toBe(url);
  });
});

describe("Add video from URL dialog", () => {
  async function openDialog() {
    loadProjectWith(closedVideo("/data/a.mp4"));
    useAppStore.getState().setAddVideoUrlDialogOpen(true);
    const { AddVideoUrlDialog } = await import("@/components/dialogs/AddVideoUrlDialog");
    render(<AddVideoUrlDialog />);
    return screen.getByPlaceholderText(/clip\.mp4/);
  }
  const hint = /This link holds a credential/;

  it("says which links are kept and which aren't", async () => {
    await openDialog();
    expect(screen.getByText(/A public link\s+is stored in the project and re-streamed on reload/)).toBeInTheDocument();
    expect(screen.getByText(/holding a\s+credential.*is stored without it/s)).toBeInTheDocument();
    expect(screen.getByText(/asked to paste the link again/)).toBeInTheDocument();
  });

  it("keeps paste and the arrows for its box", async () => {
    const input = await openDialog();
    expect(keyReachesShortcuts(input, { code: "KeyV", key: "v", metaKey: true })).toBe(false);
    expect(keyReachesShortcuts(input, { code: "ArrowLeft", key: "ArrowLeft" })).toBe(false);
  });

  it("warns about this link only when it holds a credential", async () => {
    const input = await openDialog();
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: PUBLIC } });
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: WHOLE } });
    expect(screen.getByText(hint)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: PUBLIC } });
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });
});

describe("Paste this video's link dialog", () => {
  async function openDialogFor(video: Video) {
    loadProjectWith(video);
    useAppStore.getState().setVideo(video);
    useAppStore.getState().setPasteLinkVideo(video);
    const { PasteVideoLinkDialog } = await import("@/components/dialogs/PasteVideoLinkDialog");
    render(<PasteVideoLinkDialog />);
    return screen.getByPlaceholderText(/clip\.mp4/);
  }
  const use = () => screen.getByRole("button", { name: "Use link" }) as HTMLButtonElement;

  it("shows the link as saved", async () => {
    await openDialogFor(closedVideo(MASKED));
    expect(screen.getByText(MASKED)).toBeInTheDocument();
  });

  it("keeps paste and the arrows for its box", async () => {
    const input = await openDialogFor(closedVideo(MASKED));
    expect(keyReachesShortcuts(input, { code: "KeyV", key: "v", metaKey: true })).toBe(false);
    expect(keyReachesShortcuts(input, { code: "ArrowLeft", key: "ArrowLeft" })).toBe(false);
  });

  it("needs a link to a video file", async () => {
    const input = await openDialogFor(closedVideo(MASKED));
    expect(use().disabled).toBe(true);
    fireEvent.change(input, { target: { value: "https://drive.google.com/file/d/abc" } });
    expect(use().disabled).toBe(true);
    fireEvent.change(input, { target: { value: WHOLE } });
    expect(use().disabled).toBe(false);
  });

  it("warns about the saved form but lets it be tried", async () => {
    const input = await openDialogFor(closedVideo(MASKED));
    fireEvent.change(input, { target: { value: MASKED } });
    expect(screen.getByText(/Paste\s+the original link/)).toBeInTheDocument();
    expect(use().disabled).toBe(false);
  });

  it("the same link with a new credential: restored, closed, nothing to save", async () => {
    opensOk.add(WHOLE);
    const video = closedVideo(MASKED);
    const input = await openDialogFor(video);
    const nonce = useAppStore.getState().backendSwapNonce;
    fireEvent.change(input, { target: { value: ` ${WHOLE} ` } });
    fireEvent.click(use());
    await waitFor(() => expect(useAppStore.getState().pasteLinkVideo).toBeNull());
    expect(opened).toEqual([WHOLE]);
    expect(video.filename).toBe(MASKED);
    expect(useAppStore.getState().hasChanges).toBe(false);
    expect(dirtyFrameTracker.drain().needsFullSnapshot).toBe(false);
    expect(useAppStore.getState().backendSwapNonce).toBe(nonce + 1);
    expect((toast.success.mock.calls[0] as unknown as [string])[0]).toBe("Video link restored");
  });

  it("a different link: the project has something to save", async () => {
    const moved = "https://x.test/moved/v.mp4?token=abc123";
    opensOk.add(moved);
    const video = closedVideo(MASKED);
    const input = await openDialogFor(video);
    fireEvent.change(input, { target: { value: moved } });
    fireEvent.click(use());
    await waitFor(() => expect(useAppStore.getState().pasteLinkVideo).toBeNull());
    expect(video.filename).toBe("https://x.test/moved/v.mp4?token=***");
    expect(useAppStore.getState().hasChanges).toBe(true);
    // The name is in the base an incremental autosave builds on.
    expect(dirtyFrameTracker.drain().needsFullSnapshot).toBe(true);
  });

  it("a link that fails: stays open with the link typed, name unchanged", async () => {
    const video = closedVideo(MASKED);
    const input = await openDialogFor(video);
    fireEvent.change(input, { target: { value: WHOLE } });
    fireEvent.click(use());
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(use().disabled).toBe(false));
    expect(useAppStore.getState().pasteLinkVideo).toBe(video);
    expect(video.filename).toBe(MASKED);
    expect((input as HTMLInputElement).value).toBe(WHOLE);
    expect(useAppStore.getState().hasChanges).toBe(false);
  });

  it("Cancel forgets what was typed", async () => {
    const input = await openDialogFor(closedVideo(MASKED));
    fireEvent.change(input, { target: { value: WHOLE } });
    const video = useAppStore.getState().pasteLinkVideo;
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useAppStore.getState().pasteLinkVideo).toBeNull();
    act(() => useAppStore.getState().setPasteLinkVideo(video));
    expect((screen.getByPlaceholderText(/clip\.mp4/) as HTMLInputElement).value).toBe("");
  });
});

describe("Videos panel row", () => {
  async function renderPanel(video: Video) {
    loadProjectWith(video);
    const { VideosPanel } = await import("@/components/panels/VideosPanel");
    render(<VideosPanel />);
  }

  it("a masked link offers Paste link, and it opens the dialog for that video", async () => {
    const video = closedVideo(MASKED);
    await renderPanel(video);
    expect(screen.queryByRole("button", { name: /^Locate$/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Paste link" }));
    expect(useAppStore.getState().pasteLinkVideo).toBe(video);
  });

  it("hears about a link pasted in its dialog", async () => {
    const video = closedVideo(MASKED);
    await renderPanel(video);
    video.backend = { shape: [1, 1, 1, 1] } as never; // what the dialog's open leaves
    act(() => useAppStore.getState().markVideoUpdated());
    expect(screen.queryByRole("button", { name: "Paste link" })).not.toBeInTheDocument();
  });

  it("a public link offers nothing", async () => {
    await renderPanel(closedVideo(PUBLIC));
    expect(screen.queryByRole("button", { name: "Paste link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Locate$/ })).not.toBeInTheDocument();
  });

  it("a missing file still offers Locate", async () => {
    await renderPanel(closedVideo("/gone/v.mp4"));
    expect(screen.getByRole("button", { name: /^Locate$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paste link" })).not.toBeInTheDocument();
  });
});
