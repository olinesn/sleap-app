/**
 * Label Behaviors mode's keys. A capture-phase listener, so a behavior's letter wins over
 * the app's own single-letter shortcuts while the mode is on; every other key falls
 * through. Coding state belongs to one project, so it is dropped when the project changes.
 */
import { useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { useBehaviorStore } from "@/stores/behaviorStore";
import { handleBehaviorKey } from "@/lib/behaviorCoding";

function isTextInput(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  const tag = el?.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el?.isContentEditable === true
  );
}

const OPEN_OVERLAY =
  '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]';

export function useBehaviorKeys(): void {
  const labels = useAppStore((s) => s.labels);

  useEffect(() => {
    useBehaviorStore.getState().reset();
  }, [labels]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Not behind a dialog or a dropdown: the key belongs to it.
      if (isTextInput(e) || document.querySelector(OPEN_OVERLAY)) return;
      if (handleBehaviorKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
}
