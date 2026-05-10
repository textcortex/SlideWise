import type { Deck } from "@/lib/types";

/**
 * Slidewise deck schema version. Bump this whenever the persisted shape of a
 * Deck changes in a way old hosts cannot read transparently — adding a new
 * required field, renaming a key, restructuring an element type, etc.
 *
 * Bumping always pairs with a migrator at `MIGRATIONS[oldVersion]` that takes
 * a deck shaped at the previous version and returns one shaped at this one.
 * Migrations are run forward in order, so a v0 deck becomes v1 then v2 etc.
 *
 * Never delete an old migrator — published decks in the wild may still be at
 * any historical version, and they all need a path forward.
 */
export const CURRENT_DECK_VERSION = 1;

/**
 * One forward migration. Receives a deck shaped at version `from` and returns
 * a deck shaped at version `from + 1`. Inputs are typed as `any` because the
 * old shape is not the current `Deck` type — that is the whole point of the
 * migration.
 */
type Migrator = (deck: any) => any;

/**
 * Map of migrations keyed by the version they migrate _from_. To migrate a
 * v3 deck to current, we run MIGRATIONS[3] then MIGRATIONS[4] etc. until we
 * reach CURRENT_DECK_VERSION.
 */
const MIGRATIONS: Record<number, Migrator> = {
  // v0 → v1: pre-versioning decks (no `version` field). Same structural
  // shape as v1, so the migrator is identity — the version stamp happens
  // at the end of `migrate()`.
  0: (deck) => deck,
  // Future entries look like:
  //   1: (deck) => ({ ...deck, slides: deck.slides.map(addNewField) }),
};

/**
 * Normalise an external deck (from PPTX import, JSON import, localStorage,
 * a host prop, etc.) to the current schema. Stamps the current version on
 * its way out so downstream code can rely on `deck.version`.
 *
 * Throws if the input is missing the basic shape, or if its `version` is
 * higher than `CURRENT_DECK_VERSION` — that means the deck was written by
 * a newer Slidewise and the host should upgrade rather than silently render
 * a degraded version.
 */
export function migrate(input: unknown): Deck {
  if (!isObject(input)) {
    throw new Error("[slidewise] migrate: input is not an object");
  }
  if (!Array.isArray((input as { slides?: unknown }).slides)) {
    throw new Error("[slidewise] migrate: deck.slides is not an array");
  }

  // Decks written before versioning existed have no `version` field; treat
  // them as v0. Anything else must be a finite non-negative integer.
  const rawVersion = (input as { version?: unknown }).version;
  let version: number;
  if (rawVersion === undefined) {
    version = 0;
  } else if (
    typeof rawVersion === "number" &&
    Number.isInteger(rawVersion) &&
    rawVersion >= 0
  ) {
    version = rawVersion;
  } else {
    throw new Error(
      `[slidewise] migrate: deck.version is not a non-negative integer (got ${String(
        rawVersion
      )})`
    );
  }

  if (version > CURRENT_DECK_VERSION) {
    throw new Error(
      `[slidewise] migrate: deck version ${version} is newer than this build supports (max ${CURRENT_DECK_VERSION}). Upgrade Slidewise.`
    );
  }

  let working: any = input;
  while (version < CURRENT_DECK_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      throw new Error(
        `[slidewise] migrate: no migrator registered for version ${version} → ${
          version + 1
        }`
      );
    }
    working = step(working);
    version += 1;
  }

  return { ...working, version: CURRENT_DECK_VERSION } as Deck;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
