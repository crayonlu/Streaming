import { Inbox, type LucideIcon } from "lucide-react";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
}

export function EmptyState({ title, description, icon: Icon = Inbox }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16">
      <Icon size={28} strokeWidth={1.1} className="text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground/60 text-center max-w-xs leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}
