// Stylesheet shipped next to html/index.html.
// (no build step, no Tailwind dependency). Tweak the themed segments under
// ./styles/ to retheme exports; this file just concatenates them in order.
//
// STYLE_CSS is split into readable themed segments (one tagged-template string
// const each). The concatenation below MUST stay byte-identical to the
// historical monolith — the segment boundaries fall exactly on the section
// comments, so joining them with no separator reproduces the original string.
// Same backtick / ${...} escape rules apply inside every segment.

import { BASE_CSS } from "./styles/base.js";
import { BLOCKS_CSS } from "./styles/blocks.js";
import { CALLOUTS_CSS } from "./styles/callouts.js";
import { CHIPS_CSS } from "./styles/chips.js";
import { DATABASE_CSS } from "./styles/database.js";
import { INDEX_CSS } from "./styles/index.js";
import { LAYOUT_CSS } from "./styles/layout.js";
import { MEDIA_CSS } from "./styles/media.js";
import { PRINT_CSS } from "./styles/print.js";
import { SIDEBAR_CSS } from "./styles/sidebar.js";
import { TYPOGRAPHY_CSS } from "./styles/typography.js";
import { VIEWS_CSS } from "./styles/views.js";

export const STYLE_CSS =
  BASE_CSS +
  LAYOUT_CSS +
  SIDEBAR_CSS +
  TYPOGRAPHY_CSS +
  BLOCKS_CSS +
  CHIPS_CSS +
  INDEX_CSS +
  CALLOUTS_CSS +
  PRINT_CSS +
  MEDIA_CSS +
  DATABASE_CSS +
  VIEWS_CSS;
