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
  | "cvr" // project cover image
  | "trb" // records moved to the Trash together
  | "grp" // manuscript group
  | "drf" // manuscript draft (zero draft / author manuscript)
  | "rsl" // rewrite source link
  | "pin" // reading pin (reference beside prose)
  | "wgoal" // writing goal (word target)
  | "scol" // smart collection (saved manuscript/world filter)
  | "apre" // assistant prompt preset (saved instruction lens)
  | "man" // manuscript annotation (synopsis or margin comment)
  | "cprof" // manuscript compile profile (export front/back matter)
  | "brd" // world board
  | "bcd" // board card
  | "wmp" // world map
  | "wmly" // world map layer
  | "wpn" // world map pin
  | "plr" // place relation
  | "rrl" // record relationship (character / organization)
  | "wcal" // world calendar
  | "wkt" // world kind template (custom field definitions)
  | "wcat" // world category definition (custom Hub taxonomy)
  | "wma" // world markdown archive entry
  | "wmh" // world profile migration hold
  | "wcmo" // world calendar month
  | "wcra" // world calendar era
  | "wvg" // weave grid
  | "wvb" // weave beat
  | "wth" // weave story thread (plot-grid column)
  | "wvr" // weave beat world ref
  | "wvs" // weave setup/payoff
  | "wvt" // weave template
  | "wvx" // weave template beat
  | "wbr" // weave build-from-draft run
  | "fct" // established fact
  | "fev" // fact evidence
  | "scl" // scene location assignment
  | "sev" // story event
  | "evl" // story event location
  | "evs" // story event scene reveal
  | "evo" // story event order constraint
  | "eve" // story event evidence
  | "pas" // project assistant settings
  | "car" // chapter analysis run
  | "carc" // character analysis run (evidence-based living profile review)
  | "csp" // continuity suppression (ledger ignore / intentional)
  | "wcc"; // world contradiction check (passage vs approved world fact)

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}

/** Externally supplied IDs (e.g. from a change package) must match these patterns. */
export const RECORD_ID_PATTERN = /^rec_[A-Za-z0-9_-]{6,64}$/;
export const PACKAGE_ID_PATTERN = /^pkg_[A-Za-z0-9_-]{6,80}$/;
export const WORKSPACE_ID_PATTERN = /^wsp_[A-Za-z0-9_-]{4,64}$/;
export const PROJECT_ID_PATTERN = /^prj_[A-Za-z0-9_-]{4,64}$/;
