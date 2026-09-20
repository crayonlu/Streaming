import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn's standard text input.
 *
 * ⚠️ Currently has **no call sites** — the only real text input in the project
 * is the top-bar search box
 * (`src/features/global-search/ui/GlobalSearch.tsx`). That one is structurally
 * special (icon + dropdown + keyboard navigation, with the outline drawn on the
 * wrapping `<form>`), so it is not a use of this component and was never
 * consolidated into it.
 * When changing "input styling", check which file you actually mean first.
 *
 * Kept as-is on purpose: `components/ui/` is shadcn's component shelf
 * (`card.tsx` / `dropdown-menu.tsx` are likewise unused), and staying close to
 * upstream is what lets `shadcn add` re-sync it when needed.
 *
 * The boundary contract lives at the token layer, not the component layer:
 * `--input` is guaranteed ≥3:1 (asserted by `pnpm check:tokens`'s
 * BOUNDARY_CONTRAST), so any consumer of it is safe.
 */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-8 w-full rounded-xs border border-input bg-card px-3 py-2 text-sm text-foreground transition-colors duration-150 placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-40",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
