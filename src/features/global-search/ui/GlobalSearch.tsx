import { Clock, Search, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

// ── Search history (localStorage) ─────────────────────────────────────────────
const HISTORY_KEY = "streaming_search_history";
const MAX_HISTORY = 8;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Push a keyword to the front of history, dedup, cap at MAX_HISTORY. */
function pushHistory(keyword: string): string[] {
  const trimmed = keyword.trim();
  if (!trimmed) return loadHistory();
  const prev = loadHistory().filter((v) => v !== trimmed);
  const next = [trimmed, ...prev].slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

/** Remove a single keyword from history. */
function removeHistoryItem(keyword: string): string[] {
  const next = loadHistory().filter((v) => v !== keyword);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [history, setHistory] = useState<string[]>(loadHistory);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Refresh history list each time the input gains focus
  const handleFocus = useCallback(() => {
    setFocused(true);
    setHistory(loadHistory());
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!focused) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        inputRef.current?.blur();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [focused]);

  const navigateToSearch = useCallback(
    (keyword: string) => {
      const trimmed = keyword.trim();
      if (!trimmed) return;
      setHistory(pushHistory(trimmed));
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
      inputRef.current?.blur();
      setValue("");
    },
    [navigate],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    navigateToSearch(value);
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      inputRef.current?.focus();
    }
    if (e.key === "Escape") {
      const active = document.activeElement;
      if (active === inputRef.current) {
        e.preventDefault();
        inputRef.current?.blur();
        setValue("");
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const showDropdown = focused && (value.trim() || history.length > 0);

  return (
    <div ref={containerRef} className="relative">
      <form
        onSubmit={onSubmit}
        className={cn(
          "flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 transition-all duration-150",
          focused ? "border-ring bg-card ring-1 ring-ring/20" : "border-border/60",
        )}
      >
        <Search
          size={13}
          strokeWidth={2}
          className={cn(
            "shrink-0 transition-colors duration-150",
            focused ? "text-primary" : "text-muted-foreground/70",
          )}
        />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          onFocus={handleFocus}
          onBlur={() => {
            setTimeout(() => {
              if (mountedRef.current) setFocused(false);
            }, 150);
          }}
          placeholder="搜索直播间…"
          aria-label="搜索直播间"
          className={cn(
            "min-w-0 w-44 bg-transparent text-sm text-foreground",
            "placeholder:text-muted-foreground/50",
            "focus:outline-none",
            "[&::-webkit-search-cancel-button]:hidden",
          )}
        />
      </form>

      {/* ── Dropdown: search history + type-to-search ── */}
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border border-border bg-popover shadow-md max-h-64 overflow-y-auto">
          {/* Type-to-search suggestion */}
          {value.trim() && (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                navigateToSearch(value);
              }}
            >
              <Search size={12} className="shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">
                搜索 "<span className="font-medium">{value.trim()}</span>"
              </span>
            </button>
          )}

          {/* History entries */}
          {history.length > 0 && (
            <>
              {value.trim() && <div className="my-1 border-t border-border/50" />}
              <div className="px-3 py-1">
                <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                  搜索历史
                </span>
              </div>
              {history.map((item) => (
                <div
                  key={item}
                  className="group flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                >
                  <Clock size={12} className="shrink-0 text-muted-foreground/50" />
                  <button
                    type="button"
                    className="flex-1 truncate text-left"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      navigateToSearch(item);
                    }}
                  >
                    {item}
                  </button>
                  <button
                    type="button"
                    aria-label={`删除 "${item}"`}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setHistory(removeHistoryItem(item));
                    }}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
