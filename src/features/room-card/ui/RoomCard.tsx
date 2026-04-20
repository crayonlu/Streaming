import { ImageIcon, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { FollowButton } from "@/features/follow-button/ui/FollowButton";
import { cn } from "@/lib/utils";
import { PLATFORM_LABEL } from "@/shared/lib/platform";
import type { RoomCard as RoomCardModel } from "@/shared/types/domain";

interface RoomCardProps {
  room: RoomCardModel;
}

export function RoomCard({ room }: RoomCardProps) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <li
      className={cn(
        "group relative rounded-lg bg-card overflow-hidden cursor-pointer",
        "ring-1 ring-transparent",
        "transition-all duration-150 ease-out",
        "hover:ring-border hover:shadow-sm",
      )}
    >
      {/* ── Cover ── */}
      <Link
        to={`/player/${room.platform}/${room.roomId}`}
        className="block"
        aria-label={room.title}
      >
        <div className="card-cover">
          {room.coverUrl && !imgFailed ? (
            <img
              src={room.coverUrl}
              alt={room.title}
              loading="lazy"
              onError={() => setImgFailed(true)}
              className="h-full w-full object-cover transition-transform duration-300"
            />
          ) : (
            <div className="h-full w-full bg-muted/80 flex flex-col items-center justify-center gap-1">
              <ImageIcon size={20} strokeWidth={1.2} className="text-muted-foreground/30" />
              <span className="text-[10px] text-muted-foreground/45">暂无封面</span>
            </div>
          )}

          {/* Live pill */}
          {room.isLive && (
            <span className="absolute left-2 top-2 rounded-full bg-live px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-white uppercase">
              Live
            </span>
          )}

          {/* Platform chip */}
          <span className="absolute right-2 top-2 rounded-full bg-black/38 px-1.5 py-0.5 text-[9px] font-medium text-white/90 backdrop-blur-sm">
            {PLATFORM_LABEL[room.platform] ?? room.platform}
          </span>

          {/* Follow button — floats bottom-right of cover */}
          <FollowButton room={room} compact />
        </div>
      </Link>

      {/* ── Meta ── */}
      <div className="px-3 pb-2.5 pt-2 flex flex-col gap-1">
        <Link to={`/player/${room.platform}/${room.roomId}`}>
          <p className="clamp-2 text-[13px] font-medium leading-snug text-foreground transition-colors duration-150 group-hover:text-primary">
            {room.title}
          </p>
        </Link>

        <div className="flex items-center gap-1 min-w-0">
          <span className="clamp-1 text-[11px] text-muted-foreground">{room.streamerName}</span>
          {room.viewerCountText && (
            <>
              <span className="shrink-0 text-border select-none">·</span>
              <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
                <Users size={9} strokeWidth={1.8} />
                {room.viewerCountText}
              </span>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
