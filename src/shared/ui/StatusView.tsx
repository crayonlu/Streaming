import { AlertCircle, WifiOff } from "lucide-react";

type StatusTone = "loading" | "error" | "offline";

interface StatusViewProps {
  title: string;
  tone: StatusTone;
  hint?: string;
}

export function StatusView({ title, hint, tone }: StatusViewProps) {
  if (tone === "loading") {
    return (
      <div className="flex flex-col items-center justify-center gap-2.5 py-16">
        <div
          className="h-5 w-5 rounded-full border-2 border-muted border-t-primary/60 animate-spin"
          aria-hidden="true"
        />
        <p className="text-xs text-muted-foreground">{title}</p>
      </div>
    );
  }

  const Icon = tone === "error" ? AlertCircle : WifiOff;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16">
      <Icon size={20} strokeWidth={1.4} className="text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{title}</p>
      {hint && (
        <p className="text-xs text-muted-foreground/60 text-center max-w-xs leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}
