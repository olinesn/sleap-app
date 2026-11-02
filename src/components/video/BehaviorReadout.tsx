/**
 * On the video: which behaviors are happening at this frame, and, in Label Behaviors mode,
 * what the keys will do. Always rendered; shows nothing without either. Not interactive.
 */
import { useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import { useBehaviorStore } from "@/stores/behaviorStore";
import {
  behaviorColor,
  behaviorOfEvent,
  boutWho,
  eventsAtFrame,
  isNotType,
} from "@/lib/behaviorEvents";
import { focalAnimal } from "@/lib/behaviorCoding";

export function BehaviorReadout() {
  const labels = useAppStore((s) => s.labels);
  const video = useAppStore((s) => s.video);
  const frameIdx = useAppStore((s) => s.frameIdx);
  const editSeq = useAppStore((s) => s.editSeq);
  const mode = useBehaviorStore((s) => s.mode);
  const focal = useBehaviorStore((s) => s.focal);
  const running = useBehaviorStore((s) => s.running);
  const pendingTarget = useBehaviorStore((s) => s.pendingTarget);
  const rangeStart = useBehaviorStore((s) => s.rangeStart);

  const active = useMemo(() => {
    if (!labels || !video) return [];
    return eventsAtFrame(labels, video, frameIdx).filter(
      (e) => !isNotType(e.type),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editSeq re-reads labels.events after an edit.
  }, [labels, video, frameIdx, editSeq]);

  if (!labels || !video) return null;
  if (!mode && !active.length && !running.length) return null;
  const who = mode ? focalAnimal(labels) : null;
  void focal;

  return (
    <div
      className="absolute left-2 top-2 z-30 flex max-w-[60%] flex-col gap-0.5 rounded-md bg-black/70 px-2 py-1.5 text-xs text-white shadow-lg backdrop-blur-sm pointer-events-none"
      data-testid="behavior-readout"
    >
      {mode && (
        <div className="font-semibold">
          Labelling{who ? ` ${who.name}` : ""}
          {pendingTarget ? ` · ${pendingTarget.type.name}: press a target's number` : ""}
          {rangeStart !== null ? ` · range from frame ${rangeStart.toLocaleString("en-US")}` : ""}
        </div>
      )}
      {running.map((r) => (
        <div key={`${r.type.name}:${r.subject?.name ?? ""}`} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full animate-pulse"
            style={{ backgroundColor: behaviorColor(labels, r.type) }}
          />
          <span className="truncate">
            {r.type.name}
            {r.subject ? ` · ${r.subject.name}` : ""} (running)
          </span>
        </div>
      ))}
      {active.map((e, i) => {
        const type = behaviorOfEvent(labels, e);
        const color = type ? behaviorColor(labels, type) : "#ffffff";
        return (
          <div key={i} className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-sm ${e.isPredicted ? "opacity-50" : ""}`}
              style={{ backgroundColor: color }}
            />
            <span className={`truncate ${e.isPredicted ? "text-white/60" : ""}`}>
              {e.type.name}
              {boutWho(e) ? ` · ${boutWho(e)}` : ""}
              {e.isPredicted ? " ?" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
