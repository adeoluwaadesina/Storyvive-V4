"use client";

import { useEffect, useRef, useState } from "react";

export type TitleCandidate = {
  pageTitle: string;
  wikidataId?: string;
  type: string;
  snippet: string;
};

const TYPE_LABEL: Record<string, string> = {
  tv_series: "TV",
  film: "Film",
  book: "Book",
  book_series: "Book series",
  video_game: "Game",
  character: "Character",
  person: "Person",
};

type Props = {
  value: TitleCandidate | null;
  onChange: (candidate: TitleCandidate | null) => void;
  disabled?: boolean;
};

export default function TitleSearch({ value, onChange, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<TitleCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value) return; // locked in — no need to search
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setCandidates([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/resolve/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setCandidates(data.candidates ?? []);
        setOpen(true);
      } catch {
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between border-b-2 border-[#14181c] pb-2">
        <div>
          <span className="font-serif text-xl">{value.pageTitle}</span>
          {TYPE_LABEL[value.type] && (
            <span
              className={`ml-2 rounded px-1.5 py-0.5 align-middle text-[9.5px] font-bold text-white ${
                value.type === "tv_series" ? "bg-brand" : "bg-[#6e5aa8]"
              }`}
            >
              {TYPE_LABEL[value.type]}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setQuery("");
          }}
          className="text-xs text-black/40 hover:text-black/70"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center border-b-2 border-[#14181c] pb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => candidates.length > 0 && setOpen(true)}
          placeholder="Search a TV series, book, or film…"
          disabled={disabled}
          className="w-full bg-transparent font-serif text-xl placeholder:text-black/30 focus:outline-none disabled:opacity-50"
        />
        {loading && <span className="text-xs text-black/30">…</span>}
      </div>

      {open && candidates.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-black/10 bg-white shadow-[0_12px_30px_-14px_rgba(0,0,0,.25)]">
          {candidates.map((c) => (
            <button
              key={`${c.pageTitle}:${c.type}`}
              type="button"
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className="flex w-full items-center gap-3.5 border-b border-black/[0.06] px-3.5 py-3 text-left last:border-b-0 hover:bg-black/[0.02]"
            >
              <span
                className={`inline-block w-14 shrink-0 rounded px-1.5 py-1 text-center text-[9.5px] font-bold text-white ${
                  c.type === "tv_series" ? "bg-brand" : "bg-[#6e5aa8]"
                }`}
              >
                {TYPE_LABEL[c.type] ?? c.type}
              </span>
              <span>
                <span className="block text-[15px] font-semibold text-[#14181c]">{c.pageTitle}</span>
                {c.snippet && <span className="block text-xs text-black/45">{c.snippet}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
