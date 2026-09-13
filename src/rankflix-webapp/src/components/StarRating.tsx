import { useState } from "react";

interface StarRatingProps {
  /** Rating on a 0-10 scale (each star = 1 point, half-star = 0.5). */
  value: number;
  onChange?: (value: number) => void;
  /** Fires with the hovered/previewed value, or null when the pointer leaves. */
  onHoverChange?: (value: number | null) => void;
  readOnly?: boolean;
  size?: number;
}

const STAR_COUNT = 10;

const STAR_PATH =
  "M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z";

const STAR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><path d='${STAR_PATH}'/></svg>`;
const STAR_MASK_URL = `url("data:image/svg+xml,${encodeURIComponent(STAR_SVG)}")`;

export function StarRating({ value, onChange, onHoverChange, readOnly = false, size = 28 }: StarRatingProps) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const display = hoverValue ?? value;

  const setHover = (v: number | null) => {
    setHoverValue(v);
    onHoverChange?.(v);
  };

  return (
    <div
      className={`star-rating${readOnly ? " star-rating-readonly" : ""}`}
      style={{ ["--star-size" as string]: `${size}px` } as React.CSSProperties}
      onMouseLeave={() => setHover(null)}
    >
      {Array.from({ length: STAR_COUNT }, (_, i) => {
        const starIndex = i + 1;
        const fullAt = starIndex;
        const halfAt = starIndex - 0.5;
        const fillPct = display >= fullAt ? 100 : display >= halfAt ? 50 : 0;

        return (
          <span
            className="star-rating-star"
            key={starIndex}
            style={
              {
                ["--star-fill" as string]: `${fillPct}%`,
                WebkitMaskImage: STAR_MASK_URL,
                maskImage: STAR_MASK_URL,
              } as React.CSSProperties
            }
          >
            {!readOnly && (
              <>
                <button
                  type="button"
                  className="star-rating-half star-rating-half-left"
                  onMouseEnter={() => setHover(halfAt)}
                  onFocus={() => setHover(halfAt)}
                  onClick={() => onChange?.(halfAt)}
                  aria-label={`Rate ${halfAt} out of 10`}
                />
                <button
                  type="button"
                  className="star-rating-half star-rating-half-right"
                  onMouseEnter={() => setHover(fullAt)}
                  onFocus={() => setHover(fullAt)}
                  onClick={() => onChange?.(fullAt)}
                  aria-label={`Rate ${fullAt} out of 10`}
                />
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}
