"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "next-intl";
import { Maximize, Minus, Plus } from "lucide-react";
import { MAX_ZOOM, MIN_ZOOM, zoomTier, type Camera, type Viewport } from "../model/org-chart-model";

/**
 * The Organization's one chart canvas (B-183): a stage that pans on drag and zooms around the pointer, and a world
 * moved by a camera straight on the element, not through React. The people chart and the structure both draw on it.
 * `panelWidth` is the room a side panel takes on the right, so fits centre in what stays visible.
 */
export function useChartCamera(panelWidth: number) {
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const cam = useRef<Camera>({ x: 0, y: 0, s: 1 });
  const flight = useRef(0);
  const [tier, setTier] = useState<"near" | "mid" | "far">("near");
  const [zoomLabel, setZoomLabel] = useState("100%");
  const [panning, setPanning] = useState(false);
  /** Set once a pointer moves past the click threshold: a drag never counts as a click on what it started on. */
  const dragged = useRef(false);

  const applyCam = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.style.transform = `translate(${cam.current.x}px, ${cam.current.y}px) scale(${cam.current.s})`;
    setTier(zoomTier(cam.current.s));
    setZoomLabel(`${Math.round(cam.current.s * 100)}%`);
  }, []);

  const flyTo = useCallback((target: Camera, ms = 560) => {
    cancelAnimationFrame(flight.current);
    const from = { ...cam.current };
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      cam.current = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, s: from.s + (target.s - from.s) * e };
      applyCam();
      if (k < 1) flight.current = requestAnimationFrame(step);
    };
    flight.current = requestAnimationFrame(step);
  }, [applyCam]);

  /** Places the camera at once: entry framings, which an animation frame cancelled on remount would otherwise lose. */
  const jumpTo = useCallback((target: Camera) => {
    cancelAnimationFrame(flight.current);
    cam.current = target;
    applyCam();
  }, [applyCam]);

  const viewport = useCallback((): Viewport => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 1200, height: rect?.height ?? 700, panel: panelWidth };
  }, [panelWidth]);

  const zoomBy = useCallback((factor: number, cx?: number, cy?: number) => {
    const v = viewport();
    const px = cx ?? (v.width - v.panel) / 2;
    const py = cy ?? v.height / 2;
    const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.current.s * factor));
    const k = s / cam.current.s;
    cancelAnimationFrame(flight.current);
    cam.current = { s, x: px - (px - cam.current.x) * k, y: py - (py - cam.current.y) * k };
    applyCam();
  }, [applyCam, viewport]);

  // Wheel zooms around the pointer; overlays (panels, menus) keep their own scroll.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest("[data-oc-overlay]")) return;
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomBy(event.deltaY < 0 ? 1.12 : 0.89, event.clientX - rect.left, event.clientY - rect.top);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  useEffect(() => () => cancelAnimationFrame(flight.current), []);

  /** Drag on the empty stage pans the world. */
  const startPan = useCallback((event: ReactPointerEvent) => {
    cancelAnimationFrame(flight.current);
    const start = { x: event.clientX, y: event.clientY, cx: cam.current.x, cy: cam.current.y };
    dragged.current = false;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragged.current && Math.hypot(dx, dy) <= 5) return;
      if (!dragged.current) setPanning(true);
      dragged.current = true;
      cam.current = { ...cam.current, x: start.cx + dx, y: start.cy + dy };
      applyCam();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPanning(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [applyCam]);

  return { stageRef, worldRef, cam, tier, zoomLabel, panning, dragged, flyTo, jumpTo, zoomBy, viewport, startPan };
}

/** Zoom in, out and fit, with the zoom read beside them: the same corner on every chart. */
export function ChartZoomControls({ label, onZoom, onFit }: { label: string; onZoom: (factor: number) => void; onFit: () => void }) {
  const t = useTranslations("orgChart.zoom");
  return (
    <>
      <span className="pointer-events-none absolute bottom-[18px] end-[58px] text-xs text-muted-foreground tabular-nums">{label}</span>
      <div data-oc-overlay className="absolute bottom-3.5 end-3.5 grid overflow-hidden rounded-control border bg-popover shadow-overlay">
        <button type="button" aria-label={t("in")} onClick={() => onZoom(1.25)} className="grid h-8 w-[34px] place-items-center text-muted-foreground hover:bg-inlay hover:text-foreground"><Plus className="size-4" /></button>
        <button type="button" aria-label={t("out")} onClick={() => onZoom(0.8)} className="grid h-8 w-[34px] place-items-center border-t text-muted-foreground hover:bg-inlay hover:text-foreground"><Minus className="size-4" /></button>
        <button type="button" aria-label={t("fit")} onClick={onFit} className="grid h-8 w-[34px] place-items-center border-t text-muted-foreground hover:bg-inlay hover:text-foreground"><Maximize className="size-4" /></button>
      </div>
    </>
  );
}
