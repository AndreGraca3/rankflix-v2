/**
 * Resizes and compresses an image file in the browser and returns it as a JPEG
 * data URL, so it can be stored directly in a text DB column with no external
 * file storage (S3, Supabase Storage, etc.) required.
 */
export function fileToResizedDataUrl(file: File, maxDimension = 500, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Failed to load image"));
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Crops `imageSrc` to `cropPixels`, then downsizes the result so its longest
 * side is at most `maxDimension`, and returns it as a compressed JPEG data URL.
 */
export function cropToResizedDataUrl(
  imageSrc: string,
  cropPixels: PixelCrop,
  maxDimension = 500,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Failed to load image"));
    img.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(cropPixels.width, cropPixels.height));
      const outWidth = Math.round(cropPixels.width * scale);
      const outHeight = Math.round(cropPixels.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = outWidth;
      canvas.height = outHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not supported"));
        return;
      }
      ctx.drawImage(
        img,
        cropPixels.x,
        cropPixels.y,
        cropPixels.width,
        cropPixels.height,
        0,
        0,
        outWidth,
        outHeight
      );
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = imageSrc;
  });
}

