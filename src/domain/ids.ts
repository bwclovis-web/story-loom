import { ulid } from "ulid";

export type IdPrefix =
  | "wsp"
  | "prj"
  | "rec"
  | "rev"
  | "pkg"
  | "src"
  | "aud"
  | "rvw"
  | "imp"
  | "bat"
  | "asc" // assistant conversation
  | "asm" // assistant message
  | "aci" // assistant context item
  | "apr" // assistant change proposal
  | "prf" // proofreading run
  | "dic" // dictionary entry
  | "lnk" // record link
  | "img" // record image
  | "trb" // records moved to the Trash together
  | "grp" // manuscript group
  | "drf" // manuscript draft (zero draft / author manuscript)
  | "rsl" // rewrite source link
  | "pin" // reading pin (reference beside prose)
  | "brd" // world board
  | "bcd" // board card
  | "wmp" // world map
  | "wpn" // world map pin
  | "plr" // place relation
  | "wvg" // weave grid
  | "wvb" // weave beat
  | "wvr" // weave beat world ref
  | "wvs" // weave setup/payoff
  | "wvt" // weave template
  | "wvx" // weave template beat
  | "fct" // established fact
  | "fev" // fact evidence
  | "pas"; // project assistant settings

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}

/** Externally supplied IDs (e.g. from a change package) must match these patterns. */
export const RECORD_ID_PATTERN = /^rec_[A-Za-z0-9_-]{6,64}$/;
export const PACKAGE_ID_PATTERN = /^pkg_[A-Za-z0-9_-]{6,80}$/;
export const WORKSPACE_ID_PATTERN = /^wsp_[A-Za-z0-9_-]{4,64}$/;
export const PROJECT_ID_PATTERN = /^prj_[A-Za-z0-9_-]{4,64}$/;
