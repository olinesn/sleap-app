import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/minimal_instance.slp",
);
// The app's $mod: Cmd on a Mac, Ctrl elsewhere.
const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** The events and catalog of a saved file, read back with the app's own loader. */
async function readSaved(page: import("@playwright/test").Page, file: string) {
  const b64 = fs.readFileSync(file).toString("base64");
  return page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const labels = await (window as unknown as { sleap: { loadSlp: (b: ArrayBuffer, o: unknown) => Promise<{
      eventTypes: { name: string; metadata: Record<string, string> }[];
      events: { type: { name: string }; startFrame: number; endFrame: number; source: string }[];
    }> } }).sleap.loadSlp(bytes.buffer, { openVideos: false });
    return {
      types: labels.eventTypes.map((t) => [t.name, t.metadata.key ?? ""]),
      events: labels.events.map((e) => [e.type.name, e.startFrame, e.endFrame, e.source]),
    };
  }, b64);
}

test("add a behavior, code it with its key, save and read it back", async ({ page }) => {
  // Saving falls back to a download a test can catch.
  await page.addInitScript(() => {
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { sleap?: unknown }).sleap);

  // The app's own loader (a native file picker is out of a test's reach in Chromium).
  await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    await (window as unknown as { sleap: { loadProjectFromFile: (f: File) => Promise<boolean> } }).sleap.loadProjectFromFile(
      new File([bytes], "minimal_instance.slp"),
    );
  }, fs.readFileSync(FIXTURE_PATH).toString("base64"));
  await page.waitForSelector("text=Loaded", { timeout: 15000 });

  await page.locator('[data-panel-id="behavior"]').click();
  await page.mouse.move(300, 300);
  const panel = page.locator('[data-testid="behavior-panel"]');
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-testid="behavior-mode"]')).toBeDisabled();

  await page.locator('[data-testid="behavior-add"]').click();
  await page.fill("#behavior-name", "rear");
  await page.fill("#behavior-key", "r");
  await page.locator('[data-testid="behavior-save"]').click();
  await expect(page.locator('[data-testid="behavior-row"]')).toHaveCount(1);

  // A duplicate name is refused in the dialog.
  await page.locator('[data-testid="behavior-add"]').click();
  await page.fill("#behavior-name", "rear");
  await page.locator('[data-testid="behavior-save"]').click();
  await expect(page.getByRole("alert")).toContainText("already");
  await page.keyboard.press("Escape");

  await page.locator('[data-testid="behavior-mode"]').click();
  await expect(page.locator('[data-testid="behavior-readout"]')).toContainText("Labelling");
  await page.keyboard.press("r");
  await expect(page.locator('[data-testid="behavior-readout"]')).toContainText("running");
  await page.keyboard.press("r");
  await expect(page.locator('[data-testid="bout-row"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="behavior-band"]')).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid="behavior-mode"]')).toHaveText("Label behaviors");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press(`${MOD}+s`),
  ]);
  const saved = await readSaved(page, (await download.path())!);
  expect(saved.types).toEqual([["rear", "r"]]);
  expect(saved.events).toHaveLength(1);
  expect(saved.events[0][0]).toBe("rear");
  expect(saved.events[0][3]).toBe("manual");
});
