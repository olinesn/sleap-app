/**
 * Paste a video's link again. A project holds a link without its credential
 * (`?token=***`), so a reopened one has only part of it and can't stream it. The
 * whole link goes to the backend, is used until the project closes and isn't kept.
 *
 * Opened from the video player's placeholder and the Videos panel (store field
 * `pasteLinkVideo`); mounted once in AppShell.
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
  isMaskedVideoUrl,
  isSupportedVideoUrl,
  resolveVideoFromUrl,
  sameLinkOnceSaved,
} from "@/lib/resolveVideos";
import { toast } from "@/lib/notify";

export function PasteVideoLinkDialog() {
  const video = useAppStore((s) => s.pasteLinkVideo);
  const setVideo = useAppStore((s) => s.setPasteLinkVideo);
  const [url, setUrl] = useState("");
  const [opening, setOpening] = useState(false);

  const trimmed = url.trim();
  const valid = isSupportedVideoUrl(trimmed);

  const close = () => {
    setUrl("");
    setVideo(null);
  };

  const handleUse = async () => {
    if (!video || !valid || opening) return;
    setOpening(true);
    try {
      const saved = video.filename;
      const ok = await resolveVideoFromUrl(video, trimmed);
      if (!ok) return; // failed to open — already toasted, and the link can be retried
      const s = useAppStore.getState();
      // A new credential for the same link changes nothing a save would write.
      if (!sameLinkOnceSaved(saved, trimmed)) {
        s.markChanged();
        // A video's name changed → structural; the incremental autosave must rewrite the base.
        dirtyFrameTracker.markStructural();
      }
      s.bumpOverlayVersion();
      s.markVideoUpdated(); // re-read the now-known shape → re-extend the seekbar
      s.bumpBackendSwapNonce(); // same video and frame, so force the frame to re-read
      toast.success("Video link restored");
      close();
    } finally {
      setOpening(false);
    }
  };

  return (
    <Dialog
      open={video !== null}
      onOpenChange={(o) => {
        if (!o && !opening) close();
      }}
    >
      {/* Keys stop here: the app's shortcuts would take Cmd+V and the arrows from the box. */}
      <DialogContent className="sm:max-w-lg" onKeyDown={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Paste this video&rsquo;s link</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleUse();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-muted-foreground text-sm">
              The project saved this link without its credential:
            </label>
            <code className="rounded bg-muted px-1 py-0.5 text-xs break-all">
              {Array.isArray(video?.filename) ? video?.filename[0] : video?.filename}
            </code>
            <Input
              autoFocus
              value={url}
              placeholder="https://…/clip.mp4?…"
              onChange={(e) => setUrl(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            {/* A warning, not a refusal: some servers ignore the credential. */}
            {isMaskedVideoUrl(trimmed) ? (
              <p className="text-xs leading-snug text-yellow-500">
                This is the saved form, with *** where the credential goes. Paste
                the original link.
              </p>
            ) : (
              <p className="text-muted-foreground text-xs leading-snug">
                It&rsquo;s used until you close the project and isn&rsquo;t saved,
                so you&rsquo;ll be asked for it again next time.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={close}
              disabled={opening}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!valid || opening}>
              {opening ? "Opening…" : "Use link"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
