import { logoColors } from "@repo/ds/brand";

/** The most a stored logo may weigh (Identity refuses more). */
const MAX_BYTES = 512 * 1024;

export interface PreparedLogo {
  /** A square PNG as a data URL, the file centred in it on a clear background. */
  dataUrl: string;
  /** The colours the logo is made of, most used first. */
  colors: string[];
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("unreadable"));
    image.src = src;
  });
}

function draw(image: HTMLImageElement, side: number): { canvas: HTMLCanvasElement; pixels: Uint8ClampedArray } {
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("unreadable");
  // An SVG without its own size reports 0; draw it to the full square.
  const width = image.naturalWidth || side;
  const height = image.naturalHeight || side;
  const scale = Math.min(side / width, side / height);
  const drawnWidth = width * scale;
  const drawnHeight = height * scale;
  context.drawImage(image, (side - drawnWidth) / 2, (side - drawnHeight) / 2, drawnWidth, drawnHeight);
  return { canvas, pixels: context.getImageData(0, 0, side, side).data };
}

/**
 * Turns any image the browser can show (SVG, PNG, JPEG, WebP, GIF) into the one format Fusion stores: a square PNG,
 * 512 pixels a side (256 when that is too heavy), and the colours it is made of. Throws for a file that isn't an
 * image.
 */
export async function prepareLogo(file: Blob): Promise<PreparedLogo> {
  if (!file.type.startsWith("image/")) throw new Error("unreadable");
  const url = URL.createObjectURL(file);
  try {
    const image = await load(url);
    for (const side of [512, 256]) {
      const { canvas, pixels } = draw(image, side);
      const dataUrl = canvas.toDataURL("image/png");
      if ((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75 <= MAX_BYTES) return { dataUrl, colors: logoColors(pixels) };
    }
    throw new Error("too-large");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The colours of a logo already stored (same origin), or none when it can't be read. */
export async function storedLogoColors(src: string): Promise<string[]> {
  try {
    const image = await load(src);
    return logoColors(draw(image, 128).pixels);
  } catch {
    return [];
  }
}
