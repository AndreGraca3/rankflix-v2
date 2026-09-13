import { useRef, useState } from "react";
import { readFileAsDataUrl } from "../utils/image";
import { ImageCropModal } from "./ImageCropModal";
import { Toast } from "./Toast";

export function ImageUploadButton({
  onImage,
  label = "Upload image",
  aspect = 2 / 3,
  round = false,
  renderTrigger,
}: {
  onImage: (dataUrl: string) => void;
  label?: string;
  /** width / height of the crop box, e.g. 1 for a square avatar or 2/3 for a poster */
  aspect?: number;
  /** show a circular crop shape, useful for avatars */
  round?: boolean;
  /** custom trigger element instead of the default button, e.g. the avatar image itself */
  renderTrigger?: (open: () => void, loading: boolean) => React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingImageSrc, setPendingImageSrc] = useState<string | null>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPendingImageSrc(dataUrl);
    } catch {
      setError("Could not read that image");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const open = () => inputRef.current?.click();

  return (
    <div className="image-upload">
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleChange} />
      {renderTrigger ? (
        renderTrigger(open, loading)
      ) : (
        <button type="button" className="btn-secondary" onClick={open} disabled={loading}>
          {loading ? "Processing..." : label}
        </button>
      )}
      {error && <Toast variant="error" title={error} duration={5000} onClose={() => setError(null)} />}
      {pendingImageSrc && (
        <ImageCropModal
          imageSrc={pendingImageSrc}
          aspect={aspect}
          round={round}
          onCancel={() => setPendingImageSrc(null)}
          onConfirm={(dataUrl) => {
            setPendingImageSrc(null);
            onImage(dataUrl);
          }}
        />
      )}
    </div>
  );
}
