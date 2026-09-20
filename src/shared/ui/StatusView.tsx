import { AlertCircle, FileQuestion, WifiOff } from "lucide-react";

type StatusTone = "loading" | "error" | "offline" | "empty";

interface StatusViewProps {
  title: string;
  tone: StatusTone;
  hint?: string;
}

export function StatusView({ title, hint, tone }: StatusViewProps) {
  if (tone === "loading") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <div
          className="h-5 w-5 rounded-full border-2 border-muted border-t-primary animate-spin"
          aria-hidden="true"
        />
        <p className="text-xs text-muted-foreground">{title}</p>
      </div>
    );
  }

  const Icon = tone === "error" ? AlertCircle : tone === "empty" ? FileQuestion : WifiOff;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16">
      <Icon size={20} strokeWidth={1.4} className="text-disabled-foreground" />
      <p className="text-sm text-muted-foreground">{title}</p>
      {hint && (
        <p className="text-xs text-subtle-foreground text-center max-w-80 leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}
