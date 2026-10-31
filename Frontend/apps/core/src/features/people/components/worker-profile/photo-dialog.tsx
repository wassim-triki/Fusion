"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  PersonAvatar,
  Slider,
} from "@repo/ds";
import { usePhoto } from "@repo/api/query";
import { ImageUp, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { useRefusal } from "@/i18n/words";
import { usePhotoMutations } from "../../api/use-people";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;
/** The crop window, in CSS pixels; the saved photo is OUTPUT pixels square. */
const VIEW = 280;
const OUTPUT = 512;
const MAX_ZOOM = 4;
const KEY_STEP = 8;

interface Crop {
  zoom: number;
  /** The image centre's offset from the window's centre, in window pixels. */
  x: number;
  y: number;
}

/** The image's scale in the window: it covers the window at zoom 1. */
const scaleOf = (image: HTMLImageElement, zoom: number) => (VIEW / Math.min(image.naturalWidth, image.naturalHeight)) * zoom;

/** Keeps the window covered: the image never leaves an empty edge. */
function clamp(image: HTMLImageElement, crop: Crop): Crop {
  const scale = scaleOf(image, crop.zoom);
  const maxX = (image.naturalWidth * scale - VIEW) / 2;
  const maxY = (image.naturalHeight * scale - VIEW) / 2;
  return { zoom: crop.zoom, x: Math.max(-maxX, Math.min(maxX, crop.x)), y: Math.max(-maxY, Math.min(maxY, crop.y)) };
}

/** Draws the window's square onto an OUTPUT canvas and encodes it (WebP where the browser can, else PNG). */
function render(image: HTMLImageElement, crop: Crop): Promise<Blob> {
  const scale = scaleOf(image, crop.zoom);
  const side = VIEW / scale;
  const sx = image.naturalWidth / 2 - crop.x / scale - side / 2;
  const sy = image.naturalHeight / 2 - crop.y / scale - side / 2;
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT;
  canvas.height = OUTPUT;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("Canvas unavailable"));
  context.imageSmoothingQuality = "high";
  context.drawImage(image, sx, sy, side, side, 0, 0, OUTPUT, OUTPUT);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Encoding failed"))), "image/webp", 0.9)
  );
}

/** The image as the window shows it, at any size: the crop window itself and the small previews. */
function Framed({ image, crop, size }: { image: HTMLImageElement; crop: Crop; size: number }) {
  const ratio = size / VIEW;
  const scale = scaleOf(image, crop.zoom) * ratio;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local object URL being cropped
    <img
      src={image.src}
      alt=""
      draggable={false}
      className="pointer-events-none absolute max-w-none select-none"
      style={{
        width: image.naturalWidth * scale,
        height: image.naturalHeight * scale,
        left: size / 2 + crop.x * ratio - (image.naturalWidth * scale) / 2,
        top: size / 2 + crop.y * ratio - (image.naturalHeight * scale) / 2,
      }}
    />
  );
}

/** Change a person's photo: choose an image, position and zoom it in a round window, save it as a 512px square. */
export function PhotoDialog({
  open,
  onOpenChange,
  employeeKey,
  displayName,
  photoUrl,
  isSelf,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeKey: string;
  displayName: string;
  photoUrl: string | null;
  isSelf: boolean;
}) {
  const t = useTranslations("profile.photo");
  const refusal = useRefusal();
  const current = usePhoto(photoUrl);
  const { upload, remove } = usePhotoMutations(employeeKey);
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; crop: Crop } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const busy = upload.isLoading || remove.isLoading;

  // The chosen file's object URL lives as long as the image does.
  useEffect(() => () => {
    if (image) URL.revokeObjectURL(image.src);
  }, [image]);

  useEffect(() => {
    if (open) return;
    setImage(null);
    setError(null);
  }, [open]);

  const choose = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!TYPES.includes(file.type)) return setError(t("wrongType"));
    if (file.size > MAX_BYTES) return setError(t("tooLarge"));
    const next = new Image();
    next.onload = () => {
      setImage(next);
      setCrop({ zoom: 1, x: 0, y: 0 });
    };
    next.onerror = () => {
      URL.revokeObjectURL(next.src);
      setError(t("unreadable"));
    };
    next.src = URL.createObjectURL(file);
  };

  const move = (next: Crop) => image && setCrop(clamp(image, next));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, crop };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    move({ ...start.crop, x: start.crop.x + event.clientX - start.x, y: start.crop.y + event.clientY - start.y });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] }[event.key];
    if (!step) return;
    event.preventDefault();
    move({ ...crop, x: crop.x + step[0]!, y: crop.y + step[1]! });
  };

  const save = async () => {
    if (!image) return;
    setError(null);
    try {
      await upload.mutateAsync(await render(image, crop));
      toast.success(t("saved"));
      onOpenChange(false);
    } catch (caught) {
      setError(refusal(caught, t("failed")));
    }
  };

  const removePhoto = async () => {
    setError(null);
    try {
      await remove.mutateAsync();
      toast.success(t("removed"));
      onOpenChange(false);
    } catch (caught) {
      setError(refusal(caught, t("failed")));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{isSelf ? t("titleSelf") : t("title", { name: displayName })}</DialogTitle>
        </DialogHeader>

        <input
          ref={input}
          type="file"
          accept={TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />

        {image ? (
          <div className="grid justify-items-center gap-4 py-2">
            <div
              role="group"
              tabIndex={0}
              aria-label={t("position")}
              className="relative cursor-grab touch-none overflow-hidden rounded-surface bg-inlay outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
              style={{ width: VIEW, height: VIEW }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              onKeyDown={onKeyDown}
            >
              <Framed image={image} crop={crop} size={VIEW} />
              <svg aria-hidden className="pointer-events-none absolute inset-0 size-full text-background/65" viewBox={`0 0 ${VIEW} ${VIEW}`}>
                <defs>
                  <mask id="photo-window">
                    <rect width={VIEW} height={VIEW} fill="white" />
                    <circle cx={VIEW / 2} cy={VIEW / 2} r={VIEW / 2 - 4} fill="black" />
                  </mask>
                </defs>
                <rect width={VIEW} height={VIEW} fill="currentColor" mask="url(#photo-window)" />
                <circle cx={VIEW / 2} cy={VIEW / 2} r={VIEW / 2 - 4} fill="none" className="stroke-foreground/50" strokeWidth={1.5} />
              </svg>
            </div>

            <div className="flex w-full max-w-[280px] items-center gap-3">
              <ZoomOut className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <Slider
                aria-label={t("zoom")}
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={[crop.zoom]}
                onValueChange={([zoom]) => move({ ...crop, zoom: zoom ?? 1 })}
              />
              <ZoomIn className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </div>

            <div className="flex w-full items-center gap-3 border-t pt-4">
              {[64, 32, 24].map((size) => (
                <span key={size} aria-hidden className="relative shrink-0 overflow-hidden rounded-full bg-inlay" style={{ width: size, height: size }}>
                  <Framed image={image} crop={crop} size={size} />
                </span>
              ))}
              <div className="ms-auto text-end">
                <Button variant="link" size="sm" className="h-auto p-0" onClick={() => input.current?.click()}>
                  {t("chooseAnother")}
                </Button>
                <p className="type-meta text-muted-foreground">{t("hint")}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid justify-items-center gap-4 py-4">
            <PersonAvatar name={displayName} photo={current} size="profile" className="border-2" />
            <Button variant="outline" onClick={() => input.current?.click()}>
              <ImageUp className="size-4" aria-hidden /> {t("choose")}
            </Button>
            <p className="type-meta text-muted-foreground">{t("hint")}</p>
          </div>
        )}

        {error ? (
          <p role="alert" className="type-meta text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter className="items-center sm:justify-between">
          {photoUrl ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => void removePhoto()}>
              {t("remove")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button disabled={!image || busy} onClick={() => void save()}>
              {upload.isLoading ? t("saving") : t("save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
