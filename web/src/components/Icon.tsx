import { HugeiconsIcon } from "@hugeicons/react";

export function Icon({
  icon, size = 20, className, color, strokeWidth = 1.8,
}: {
  icon: any;
  size?: number;
  className?: string;
  color?: string;
  strokeWidth?: number;
}) {
  return <HugeiconsIcon icon={icon} size={size} className={className} color={color} strokeWidth={strokeWidth} />;
}
