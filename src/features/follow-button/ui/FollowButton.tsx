import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toggleFollow } from "@/shared/api/commands";
import type { RoomCard } from "@/shared/types/domain";

interface FollowButtonProps {
  room: Pick<RoomCard, "platform" | "roomId" | "followed" | "title" | "streamerName" | "coverUrl">;
  compact?: boolean;
}

export function FollowButton({ room, compact = false }: FollowButtonProps) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      toggleFollow({
        platform: room.platform,
        roomId: room.roomId,
        follow: next,
        title: room.title,
        streamerName: room.streamerName,
        coverUrl: room.coverUrl,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["follows"] });
      void queryClient.invalidateQueries({ queryKey: ["room-detail"] });
    },
  });

  if (compact) {
    /* Floating heart on cover image */
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          mutation.mutate(!room.followed);
        }}
        disabled={mutation.isPending}
        aria-label={room.followed ? "取消关注" : "关注"}
        className={cn(
          "absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-full cursor-pointer",
          "transition-all duration-120",
          room.followed
            ? "bg-live text-white"
            : "bg-black/35 text-white/75 hover:bg-black/55 hover:text-white",
        )}
      >
        <Heart size={11} strokeWidth={2} className={room.followed ? "fill-white" : "fill-none"} />
      </button>
    );
  }

  return (
    <Button
      variant={room.followed ? "muted" : "outline"}
      size="sm"
      onClick={() => mutation.mutate(!room.followed)}
      disabled={mutation.isPending}
      className="gap-1.5 text-xs"
    >
      <Heart
        size={11}
        strokeWidth={2}
        className={room.followed ? "fill-accent-foreground" : "fill-none"}
      />
      {room.followed ? "已关注" : "关注"}
    </Button>
  );
}
