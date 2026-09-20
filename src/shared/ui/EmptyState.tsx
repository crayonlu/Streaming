import { Inbox, type LucideIcon } from "lucide-react";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
}

export function EmptyState({ title, description, icon: Icon = Inbox }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16">
      <Icon size={28} strokeWidth={1.1} className="text-disabled-foreground" />
      <p className="text-sm text-muted-foreground">{title}</p>
      {description && (
        <p className="text-xs text-subtle-foreground text-center max-w-80 leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}
