import { useCallback, useEffect, useRef, useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { api } from "../api/client";
import type { MediaSearchResult } from "../api/types";

interface MediaAutocompleteProps {
  onSelect: (result: MediaSearchResult) => void;
}

export function MediaAutocomplete({ onSelect }: MediaAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const handleSelect = useCallback(
    (result: MediaSearchResult) => {
      onSelect(result);
      skipNextSearchRef.current = true;
      setQuery(`${result.title}${result.year ? ` (${result.year})` : ""}`);
      setOpen(false);
    },
    [onSelect]
  );

  return (
    <PopoverPrimitive.Root open={open && results.length > 0} onOpenChange={setOpen}>
      <div className="autocomplete">
        <PopoverPrimitive.Anchor asChild>
          <input
            ref={inputRef}
            placeholder="Search a movie or show title..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
          />
        </PopoverPrimitive.Anchor>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            className="autocomplete-dropdown"
            side="bottom"
            align="start"
            sideOffset={4}
            onOpenAutoFocus={(e) => e.preventDefault()}
            style={{ width: inputRef.current?.offsetWidth }}
          >
            <ul>
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
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </div>
    </PopoverPrimitive.Root>
  );
}
