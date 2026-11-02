/**
 * "Add video from URL" dialog (Phase 0 of cloud-media support). Streams a video
 * from a public or presigned http(s) URL via io's createVideoBackend (lazy HTTP
 * Range) and appends it to the current project. The URL is stored as the video's
 * canonical filename, so the reference is portable and re-streams on reload. A
 * credential in it isn't kept, and then PasteVideoLinkDialog asks for the link back.
 *
 * Opened from the File menu (store flag `addVideoUrlDialogOpen`); mounted once in
 * AppShell. Standalone for now — intended to also feed the Videos-panel dropzone
 * (#319) once that lands.
 */

import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { dirtyFrameTracker } from "@/lib/autosaveDirty";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addVideoUrlToLabels,
  isSupportedVideoUrl,
  urlHoldsCredential,
} from "@/lib/resolveVideos";
import { toast } from "@/lib/notify";

export function AddVideoUrlDialog() {
  const open = useAppStore((s) => s.addVideoUrlDialogOpen);
  const setOpen = useAppStore((s) => s.setAddVideoUrlDialogOpen);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const trimmed = url.trim();
  const valid = isSupportedVideoUrl(trimmed);

  const close = () => {
    setUrl("");
    setOpen(false);
  };

  const handleAdd = async () => {
    const labels = useAppStore.getState().labels;
    if (!labels || !valid || adding) return;
    setAdding(true);
    try {
      const video = await addVideoUrlToLabels(labels, trimmed);
      if (!video) return; // unsupported / failed to open — already toasted
      labels.reindex();
      const s = useAppStore.getState();
      s.markChanged();
      // Added a video → structural; the incremental autosave must rewrite the base.
      dirtyFrameTracker.markStructural();
      s.bumpOverlayVersion();
      s.setVideo(video);
      s.setFrameIdx(0);
      toast.success("Added video from URL");
      close();
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !adding) close();
      }}
    >
      {/* Keys stop here: the app's shortcuts would take Cmd+V and the arrows from the box. */}
      <DialogContent className="sm:max-w-lg" onKeyDown={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Add video from URL</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleAdd();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-muted-foreground text-sm">
              Stream a video from a public or presigned http(s) URL. A public link
              is stored in the project and re-streamed on reload. A link holding a
              credential, such as a token, is stored without it: when you reopen the
              project, you&rsquo;ll be asked to paste the link again.
            </label>
            <Input
              autoFocus
              value={url}
              placeholder="https://…/clip.mp4"
              onChange={(e) => setUrl(e.target.value)}
              spellCheck={false}
            />
            {urlHoldsCredential(trimmed) && (
              <p className="text-xs leading-snug text-yellow-500">
                This link holds a credential. Keep a copy of it: you&rsquo;ll need
                to paste it again after reopening the project.
              </p>
            )}
            <p className="text-muted-foreground text-xs leading-snug">
              Must be a direct link to a video file (e.g. a presigned S3/GCS URL)
              on a host that allows cross-origin range requests. Watch/share
              pages such as YouTube or Google Drive links won&rsquo;t
              work&nbsp;— account-based Drive/Dropbox loading is coming soon.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={close}
              disabled={adding}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!valid || adding}>
              {adding ? "Adding…" : "Add video"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
