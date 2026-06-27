import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export type TutorialAvatarExpression = "happy" | "pointing" | "thinking" | "warning" | "success";

export type TutorialAvatarProps = {
  imageUrl?: string;
  expression?: TutorialAvatarExpression;
  size?: number;
  className?: string;
};

/**
 * Placeholder do mascote do tutorial.
 * Hoje renderiza um círculo amarelo com uma estrela ao centro.
 * Quando `imageUrl` for informado, basta passar a URL para trocar pelo retrato real.
 */
export function TutorialAvatar({ imageUrl, expression = "happy", size = 76, className }: TutorialAvatarProps) {
  if (imageUrl) {
    return (
      <div
        className={cn("tutorial-avatar-placeholder overflow-hidden", className)}
        style={{ width: size, height: size }}
        data-expression={expression}
      >
        <img src={imageUrl} alt="" className="h-full w-full object-cover" />
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
