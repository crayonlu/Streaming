import { Skeleton } from "@/components/ui/skeleton";

export function CardSkeleton() {
  return (
    <div className="rounded-md overflow-hidden bg-card ring-1 ring-transparent">
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="px-3 pb-3 pt-2 flex flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}
