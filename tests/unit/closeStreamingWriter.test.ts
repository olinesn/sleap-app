/**
 * `closeStreamingWriter` closes once and hands back what went wrong instead of
 * throwing, so the `finally` calling it can finish its cleanup. How each save uses
 * it is tested with that save.
 */
import { describe, it, expect } from "../bun-test";
import { closeStreamingWriter } from "@/lib/closeStreamingWriter";

function writerThat(close: () => Promise<void>) {
  const writer = {
    closes: 0,
    close: () => {
      writer.closes += 1;
      return close();
    },
  };
  return writer;
}

describe("closeStreamingWriter", () => {
  it("returns null for a close that resolves, as sleap-io.js versions that never reject do", async () => {
    const writer = writerThat(async () => {});
    expect(await closeStreamingWriter(writer)).toBeNull();
    expect(writer.closes).toBe(1);
  });

  it("returns the error of a close that rejects, and does not try again", async () => {
    const failed = new Error("Could not write 96 bytes at offset 0 of the file.");
    const writer = writerThat(async () => {
      throw failed;
    });
    expect(await closeStreamingWriter(writer)).toBe(failed);
    expect(writer.closes).toBe(1);
  });

  it("makes an Error of anything else a close rejects with", async () => {
    const writer = writerThat(() => Promise.reject("worker gone"));
    const err = await closeStreamingWriter(writer);
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toBe("worker gone");
  });

  it("counts a rejection with nothing in it as a failure", async () => {
    const writer = writerThat(() => Promise.reject(undefined));
    expect(await closeStreamingWriter(writer)).toBeInstanceOf(Error);
  });
});
