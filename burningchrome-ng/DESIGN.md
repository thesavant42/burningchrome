# burningchrome-ng — Design & Progress

## Goal
Rebuild the bucket browser (burning-chrome) with succinct elegance and reliance on libraries.

## Current State
- Original `buckets.js` is ~2200 lines, all in one file
- Data layer is library-backed (idb, jszip, DOMParser)
- UI layer is 1800+ lines of boilerplate DOM manipulation
- Everything is coupled: fetch → parse → state → render in one function

## Key Insight
The only real custom logic is XML parsing (~40 lines of DOM queries). Everything else is data-to-view wiring. The 2000 lines is all presentation boilerplate + features (tree, stats, export, backup, reports) that should be submodules.

## Decisions
- TBD

## Progress
- TBD