/** An animal's name above its skeleton while labelling behaviors (`animalTag`). */
import { describe, it, expect } from "../bun-test";
import { renderInstances, type RenderedInstance } from "@/canvas/SkeletonRenderer";

function canvas() {
  const fonts: Array<[string, string]> = [];
  let font = "";
  const ctx = new Proxy(
    {
      measureText: () => ({ width: 10 }),
      fillText: (text: string) => fonts.push([text, font]),
      createLinearGradient: () => ({ addColorStop() {} }),
    } as Record<string, unknown>,
    {
      get: (t, k: string) => (k in t ? t[k] : () => {}),
      set: (t, k: string, v) => {
        if (k === "font") font = v;
        t[k] = v;
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fonts };
}

function instance(tag?: RenderedInstance["animalTag"]): RenderedInstance {
  return {
    nodes: [{ x: 5, y: 5, visible: true, complete: false, name: "a" }],
    edges: [],
    color: [1, 2, 3],
    isPredicted: true,
    isSelected: false,
    trackName: "track 7",
    animalTag: tag,
    visible: true,
    showNonVisible: true,
  } as RenderedInstance;
}

describe("renderInstances", () => {
  it("writes the animal's name, bold on the one the keys label", () => {
    const { ctx, fonts } = canvas();
    renderInstances(
      ctx,
      [
        instance({ text: "1 id_0", color: [9, 9, 9], focal: false }),
        instance({ text: "2 id_1", color: [8, 8, 8], focal: true }),
      ],
      { showLabels: false },
    );
    const tag = (name: string) => fonts.find(([t]) => t === name)?.[1] ?? "";
    expect(tag("1 id_0")).not.toContain("bold");
    expect(tag("2 id_1")).toContain("bold");
  });

  it("writes the animal instead of the track, even with predictions colored", () => {
    const { ctx, fonts } = canvas();
    renderInstances(ctx, [instance({ text: "1 id_0", color: [9, 9, 9], focal: false })], {
      showLabels: false,
      colorPredicted: true,
    });
    expect(fonts.map(([t]) => t)).toEqual(["1 id_0"]);
  });

  it("writes none on an instance without a tag, or one that is hidden", () => {
    const { ctx, fonts } = canvas();
    const hidden = instance({ text: "1 id_0", color: [9, 9, 9], focal: false });
    hidden.visible = false;
    renderInstances(ctx, [instance(), hidden], { showLabels: false });
    expect(fonts.length).toBe(0);
  });
});
