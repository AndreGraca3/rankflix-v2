import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { MediaSearchResult } from "../api/types";

interface MediaAutocompleteProps {
  onSelect: (result: MediaSearchResult) => void;
}

export function MediaAutocomplete({ onSelect }: MediaAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (result: MediaSearchResult) => {
    onSelect(result);
    setQuery(`${result.title}${result.year ? ` (${result.year})` : ""}`);
    setOpen(false);
  };

  return (
    <div className="autocomplete" ref={containerRef}>
      <input
        placeholder="Search a movie or show title..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {open && results.length > 0 && (
        <ul className="autocomplete-dropdown">
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
        </ul>
      )}
    </div>
  );
}
