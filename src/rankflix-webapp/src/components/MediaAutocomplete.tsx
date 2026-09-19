import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import type { MediaSearchResult } from "../api/types";
import { useDropdownOutsideClick } from "./useDropdownOutsideClick";

interface MediaAutocompleteProps {
  onSelect: (result: MediaSearchResult) => void;
}

export function MediaAutocomplete({ onSelect }: MediaAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  // Set right before setQuery(...) in handleSelect so the search effect below (which also
  // fires on that same query change) knows to skip re-searching/reopening the dropdown for
  // the title the user just picked - otherwise it silently reopens ~300ms later, and the
  // *next* click elsewhere (e.g. an "Add" button) gets absorbed just to close it again.
  const skipNextSearchRef = useRef(false);

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api
        .get<MediaSearchResult[]>(`/api/media/search?query=${encodeURIComponent(query)}`)
        .then((r) => {
          setResults(r);
          setOpen(true);
        })
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  const close = useCallback(() => setOpen(false), []);
  useDropdownOutsideClick(open, close, [containerRef, dropdownRef]);

  // Render the dropdown in a portal so it renders on a layer above the modal instead of
  // being clipped by the modal's overflow: auto/hidden.
  useLayoutEffect(() => {
    if (!open || !inputRef.current) return;
    const updatePos = () => {
      const rect = inputRef.current!.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open]);

  const handleSelect = (result: MediaSearchResult) => {
    onSelect(result);
    skipNextSearchRef.current = true;
    setQuery(`${result.title}${result.year ? ` (${result.year})` : ""}`);
    setOpen(false);
  };

  return (
    <div className="autocomplete" ref={containerRef}>
      <input
        ref={inputRef}
        placeholder="Search a movie or show title..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {open &&
        results.length > 0 &&
        createPortal(
          <ul
            className="autocomplete-dropdown autocomplete-dropdown-portal"
            ref={dropdownRef}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            {results.map((r) => (
              <li key={`${r.type}-${r.tmdbId}`} onClick={() => handleSelect(r)}>
                {r.posterUrl ? (
                  <img src={r.posterUrl} alt="" />
                ) : (
                  <div className="autocomplete-poster-placeholder" />
                )}
                <div>
                  <div className="autocomplete-title">{r.title}</div>
                  <div className="muted">
                    {r.year ?? "—"} · {r.type}
                  </div>
                </div>
              </li>
            ))}
          </ul>,
          document.body
        )}
    </div>
  );
}
