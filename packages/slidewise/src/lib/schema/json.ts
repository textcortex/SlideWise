import type { Deck } from "@/lib/types";
import { migrate } from "./migrate";

/**
 * Normalise a host-supplied deck JSON — either a parsed `Deck` object or a
 * JSON string — into a current-schema `Deck`. Runs the input through
 * `migrate()` so older `version` stamps are upgraded and the basic shape is
 * validated. This is the entry point hosts use when feeding AI-generated
 * decks to `<SlidewiseEditor jsonDeck={...} />`.
 *
 * Throws if the string isn't valid JSON, or if the resulting object is
 * missing the basic `Deck` shape / its `version` is newer than this build.
 */
export function resolveJsonDeck(input: Deck | string): Deck {
  const parsed: unknown =
    typeof input === "string" ? (JSON.parse(input) as unknown) : input;
  return migrate(parsed);
}
