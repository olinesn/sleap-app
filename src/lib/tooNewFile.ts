/**
 * A file too new for this version of the app.
 *
 * sleap-io.js refuses an `.slp` in a format newer than it can read, rather than
 * opening it as an empty project (Python sleap-io 0.10 writes format 3.0 by
 * default). Its own message is for developers ("Upgrade sleap-io.js"), so the app
 * says it in words for the person using it.
 *
 * This goes by the error's name, not `instanceof`: a sleap-io.js without the
 * refusal has no class to import, and this way the app builds against either.
 */
import { toast } from "@/lib/notify";

const TOO_NEW_ERROR_NAME = "UnsupportedSlpFormatError";

/** The message for a too-new file, or `null` if `err` is any other failure. */
export function tooNewFileMessage(
  err: unknown,
  filename?: string
): string | null {
  if (!(err instanceof Error) || err.name !== TOO_NEW_ERROR_NAME) return null;
  const formatId = (err as Error & { formatId?: unknown }).formatId;
  const format =
    typeof formatId === "number"
      ? ` (SLP format ${Number.isInteger(formatId) ? formatId.toFixed(1) : formatId})`
      : "";
  return (
    `${filename || "This file"} was made by a newer version of SLEAP${format}, ` +
    "and this version can't open it. Update SLEAP if a newer version is " +
    "available, or re-save the file from Python sleap-io with legacy_format=True."
  );
}

/**
 * Show a too-new file's message, up until it is dismissed: it says what to do,
 * which takes longer to read than a toast normally stays. Returns whether `err`
 * was one, so a caller can show its usual error otherwise.
 */
export function showTooNewFileToast(err: unknown, filename?: string): boolean {
  const message = tooNewFileMessage(err, filename);
  if (!message) return false;
  toast.error("Can't open this file", {
    description: message,
    duration: Infinity,
  });
  return true;
}

/** Text for a failed `.slp` read: the too-new message, or the error's own. */
export function loadErrorText(err: unknown): string {
  return (
    tooNewFileMessage(err) ?? (err instanceof Error ? err.message : String(err))
  );
}
