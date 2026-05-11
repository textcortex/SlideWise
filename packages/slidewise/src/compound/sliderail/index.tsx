import type { CSSProperties } from "react";
import { Root, type SlideRailRootProps } from "./Root";
import { Header, type SlideRailHeaderProps } from "./Header";
import { List, type SlideRailListProps } from "./List";
import { Item, type SlideRailItemProps } from "./Item";
import { Thumbnail, type SlideRailThumbnailProps } from "./Thumbnail";
import { Number, type SlideRailNumberProps } from "./Number";
import { AddButton, type SlideRailAddButtonProps } from "./AddButton";

export interface SlideRailProps {
  className?: string;
  style?: CSSProperties;
  /** Rail width; forwarded to `<SlideRail.Root>`. */
  width?: number | string;
  /** Omit the header. */
  hideHeader?: boolean;
  /** Omit the "New Slide" button. */
  hideAddButton?: boolean;
}

/**
 * Default SlideRail arrangement. Equivalent to:
 *
 * ```tsx
 * <Slidewise.SlideRail.Root>
 *   <Slidewise.SlideRail.Header />
 *   <Slidewise.SlideRail.List />
 *   <Slidewise.SlideRail.AddButton />
 * </Slidewise.SlideRail.Root>
 * ```
 *
 * For full control (per-row context menus, custom thumbnail layout,
 * etc.), drop down to the subparts directly.
 */
function DefaultSlideRail({
  className,
  style,
  width,
  hideHeader,
  hideAddButton,
}: SlideRailProps = {}) {
  return (
    <Root className={className} style={style} width={width}>
      {!hideHeader && <Header />}
      <List />
      {!hideAddButton && <AddButton />}
    </Root>
  );
}

/**
 * `<Slidewise.SlideRail />` is both the default arrangement and a
 * namespace of subparts. Mirrors `<Slidewise.TopBar>`.
 */
export const SlideRail = Object.assign(DefaultSlideRail, {
  Root,
  Header,
  List,
  Item,
  Thumbnail,
  Number,
  AddButton,
});

export { useSlideRailItem, type SlideRailItemContextValue } from "./ItemContext";
export type {
  SlideRailRootProps,
  SlideRailHeaderProps,
  SlideRailListProps,
  SlideRailItemProps,
  SlideRailThumbnailProps,
  SlideRailNumberProps,
  SlideRailAddButtonProps,
};
