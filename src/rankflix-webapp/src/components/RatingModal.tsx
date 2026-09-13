import { useState } from "react";
import { StarRating } from "./StarRating";

interface RatingModalProps {
  title: string;
  posterUrl?: string | null;
  initialRating: number;
  initialComment: string;
  onCancel: () => void;
  onSubmit: (rating: number, comment: string) => void;
}

export function RatingModal({ title, posterUrl, initialRating, initialComment, onCancel, onSubmit }: RatingModalProps) {
  const [rating, setRating] = useState(initialRating);
  const [comment, setComment] = useState(initialComment);
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
  };

  const previewValue = hoverValue ?? rating;

  return (
    <div
      className={`rating-modal-overlay${closing ? " closing" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        requestClose();
      }}
    >
      <div
        className={`rating-modal${closing ? " closing" : ""}`}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={() => {
          if (closing) onCancel();
        }}
      >
        <button className="media-modal-close" onClick={requestClose} title="Close" type="button">
          ×
        </button>

        {posterUrl && <img className="rating-modal-poster" src={posterUrl} alt={title} />}
        <h2 className="rating-modal-title">{title}</h2>
        <p className="muted">How would you rate it?</p>

        <div className="rating-modal-stars">
          <StarRating value={rating} onChange={setRating} onHoverChange={setHoverValue} size={32} />
          <span className="rating-modal-value">{previewValue > 0 ? `${previewValue}/10` : "Tap a star"}</span>
        </div>

        <div className="rating-modal-comment-wrap">
          <textarea
            className="rating-modal-comment"
            placeholder="Add a comment (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
          />
          {comment.length > 0 && (
            <button
              type="button"
              className="rating-modal-comment-clear"
              title="Clear comment"
              onClick={() => setComment("")}
            >
              🗑 Clear
            </button>
          )}
        </div>

        <div className="row rating-modal-actions">
          <button type="button" disabled={rating <= 0} onClick={() => onSubmit(rating, comment)}>
            {initialRating > 0 ? "Update vote" : "Submit vote"}
          </button>
          <button type="button" className="btn-secondary" onClick={requestClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
