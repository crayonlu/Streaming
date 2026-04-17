import { Search } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

export function GlobalSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const keyword = value.trim();
    if (!keyword) return;
    navigate(`/search?q=${encodeURIComponent(keyword)}`);
    inputRef.current?.blur();
  };

  return (
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
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="搜索直播间…"
        aria-label="搜索直播间"
        className={cn(
          "min-w-0 w-44 bg-transparent text-sm text-foreground",
          "placeholder:text-muted-foreground/50",
          "focus:outline-none",
          // Remove browser default search input styling
          "[&::-webkit-search-cancel-button]:hidden",
        )}
      />
    </form>
  );
}
