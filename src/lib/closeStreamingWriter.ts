/**
 * Close a save's `StreamingH5Writer` and return what went wrong, or null, rather
 * than throwing, so the `finally` calling this can finish its own cleanup.
 *
 * The last of a file is written when the writer closes, and sleap-io.js rejects
 * then if the file isn't whole, so a save must not trust its file until this has
 * returned null. Every save follows the same shape:
 *
 *   let closeError: Error | null = null;
 *   try {
 *     // ...the save's writing steps...
 *   } finally {
 *     closeError = await closeStreamingWriter(writer);
 *   }
 *   if (closeError) throw closeError;
 *
 * The `throw` is only reached if the steps worked, so an earlier error stays the
 * one the user sees: once a step has failed, the close usually fails as well.
 *
 * Call this once per writer: `close` ends the writer's worker, and asking a worker
 * that has ended to close again never gets an answer.
 */
export async function closeStreamingWriter(writer: {
  close(): Promise<void>;
}): Promise<Error | null> {
  try {
    await writer.close();
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}
