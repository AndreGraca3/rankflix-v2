import { useCallback, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { cropToResizedDataUrl } from "../utils/image";
import { Modal } from "./Modal";

export function ImageCropModal({
  imageSrc,
  aspect,
  round,
  onCancel,
  onConfirm,
}: {
  imageSrc: string;
  aspect: number;
  round?: boolean;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const confirm = async () => {
    if (!croppedAreaPixels) return;
    setProcessing(true);
    try {
      const dataUrl = await cropToResizedDataUrl(imageSrc, croppedAreaPixels, aspect < 1 ? 500 : 600);
      onConfirm(dataUrl);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Modal overlayClassName="crop-modal-overlay" modalClassName="crop-modal" onClose={onCancel} disableBackdropClose={processing}>
      {(requestClose) => (
        <>
          <h2>Crop image</h2>
          <div className={`crop-area${round ? " crop-area-round" : ""}`}>
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              cropShape={round ? "round" : "rect"}
              showGrid={!round}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>
          <label className="crop-zoom-label">
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <div className="row">
            <button type="button" onClick={confirm} disabled={processing}>
              {processing ? "Saving..." : "Upload"}
            </button>
            <button type="button" className="btn-secondary" onClick={requestClose} disabled={processing}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
