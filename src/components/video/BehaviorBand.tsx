/**
 * Behavior rows under the seekbar's tracks: one lane per behavior per animal, lined up
 * with the seekbar. A label is solid, a "not" label gray, a prediction a thin bar. Click
 * seeks. Only shows when the video on screen has behavior events, or while coding.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { useBehaviorStore } from "@/stores/behaviorStore";
import {
  NOT_LABEL_COLOR,
  behaviorLanes,
  isNotType,
  type BehaviorLane,
} from "@/lib/behaviorEvents";

const LANE_PX = 8;
const LANE_GAP_PX = 1;
const MAX_BAND_PX = 96;
const PAD_PX = 2;

export function BehaviorBand({
  totalFrames,
  controlsOrder,
}: {
  totalFrames: number;
  controlsOrder: string;
}) {
  const labels = useAppStore((s) => s.labels);
  const video = useAppStore((s) => s.video);
  const editSeq = useAppStore((s) => s.editSeq);
  const mode = useBehaviorStore((s) => s.mode);
  const running = useBehaviorStore((s) => s.running);

  const lanes = useMemo(
    () => (labels && video ? behaviorLanes(labels, video) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editSeq re-reads labels.events after an edit.
    [labels, video, editSeq],
  );

  if (!labels || !video || totalFrames < 1) return null;
  if (!lanes.length && !mode && !running.length) return null;
  return (
    <BehaviorLanes
      lanes={lanes}
      totalFrames={totalFrames}
      controlsOrder={controlsOrder}
    />
  );
}

function BehaviorLanes({
  lanes,
  totalFrames,
  controlsOrder,
}: {
  lanes: BehaviorLane[];
  totalFrames: number;
  controlsOrder: string;
}) {
  const frameIdx = useAppStore((s) => s.frameIdx);
  const setFrameIdx = useAppStore((s) => s.setFrameIdx);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  const height = lanes.length
    ? PAD_PX * 2 + lanes.length * (LANE_PX + LANE_GAP_PX)
    : 0;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const last = Math.max(1, totalFrames - 1);
    const xOf = (f: number) => (f / last) * width;
    lanes.forEach((lane, i) => {
      const y = PAD_PX + i * (LANE_PX + LANE_GAP_PX);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(0, y, width, LANE_PX);
      for (const bout of lane.bouts) {
        const x = xOf(bout.startFrame);
        const w = Math.max(1, xOf(bout.endFrame + 1) - x);
        if (bout.isPredicted) {
          ctx.fillStyle = lane.color;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(x, y + LANE_PX - 3, w, 3);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = isNotType(bout.type) ? NOT_LABEL_COLOR : lane.color;
          ctx.fillRect(x, y, w, LANE_PX);
        }
      }
    });
  }, [lanes, width, height, totalFrames]);

  const laneAt = (clientY: number): number => {
    const el = containerRef.current;
    if (!el) return -1;
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop - PAD_PX;
    return Math.floor(y / (LANE_PX + LANE_GAP_PX));
  };

  return (
    <div
      className="relative grid grid-cols-subgrid grid-rows-[minmax(0,1fr)] col-span-full items-stretch bg-card border-t border-border px-2 gap-2"
      style={{ height: Math.min(Math.max(height, LANE_PX + PAD_PX * 2), MAX_BAND_PX) }}
      data-testid="behavior-band"
    >
      <div
        ref={containerRef}
        // mx-1: same inset as the main bar's canvas, so lanes line up.
        className="relative mx-1 overflow-y-auto overflow-x-hidden min-w-0 h-full rounded-sm cursor-pointer"
        onClick={(e) => {
          const el = containerRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          setFrameIdx(Math.round(ratio * Math.max(0, totalFrames - 1)));
        }}
        onPointerMove={(e) => setHover(lanes[laneAt(e.clientY)]?.label ?? null)}
        onPointerLeave={() => setHover(null)}
      >
        <canvas ref={canvasRef} className="block w-full" style={{ height }} aria-hidden="true" />
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-white/70"
          style={{ left: `${(frameIdx / Math.max(1, totalFrames - 1)) * 100}%` }}
        />
      </div>
      <div className={`relative min-w-0 ${controlsOrder}`}>
        {hover && (
          <div
            className="pointer-events-none absolute right-0 top-1/2 z-10 max-w-full -translate-y-1/2 truncate rounded bg-popover/95 px-1.5 py-0.5 text-[10px] leading-none text-popover-foreground ring-1 ring-primary/60 shadow-sm"
            title={hover}
          >
            {hover}
          </div>
        )}
      </div>
    </div>
  );
}
