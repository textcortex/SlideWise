import type { CSSProperties } from "react";

/**
 * Pushes subsequent subparts to the far edge of `<TopBar.Root>`.
 *
 * ```tsx
 * <Slidewise.TopBar.Root>
 *   <MyExitButton />
 *   <Slidewise.TopBar.Spacer />
 *   <Slidewise.TopBar.Save />
 * </Slidewise.TopBar.Root>
 * ```
 */
export interface TopBarSpacerProps {
  className?: string;
  style?: CSSProperties;
}

export function Spacer({ className, style }: TopBarSpacerProps = {}) {
  return (
    <div
      className={className}
      aria-hidden="true"
      style={{ flex: 1, minWidth: 0, ...style }}
    />
  );
}
