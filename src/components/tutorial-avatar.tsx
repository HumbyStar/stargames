import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import mascotAsset from "@/assets/tutorial-mascot.svg.asset.json";

export type TutorialAvatarExpression = "happy" | "pointing" | "thinking" | "warning" | "success";

export type TutorialAvatarProps = {
  imageUrl?: string;
  expression?: TutorialAvatarExpression;
  size?: number;
  className?: string;
};

const DEFAULT_MASCOT_URL = mascotAsset.url;

/**
 * Mascote do tutorial guiado.
 * Por padrão usa o personagem oficial; aceita `imageUrl` para sobrescrever.
 */
export function TutorialAvatar({
  imageUrl = DEFAULT_MASCOT_URL,
  expression = "happy",
  size = 76,
  className,
}: TutorialAvatarProps) {
  if (imageUrl) {
    return (
      <div
        className={cn(
          "tutorial-avatar-placeholder tutorial-avatar-mascot overflow-hidden",
          className,
        )}
        style={{ width: size, height: size }}
        data-expression={expression}
      >
        <img
          src={imageUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      </div>
    );
  }
  return (
    <div
      className={cn("tutorial-avatar-placeholder", className)}
      style={{ width: size, height: size }}
      data-expression={expression}
      aria-hidden
    >
      <Star className="size-1/2 fill-current" strokeWidth={2.25} />
    </div>
  );
}