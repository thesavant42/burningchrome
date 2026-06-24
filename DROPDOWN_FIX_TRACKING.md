# Dropdown Fix - Test Plan

## Problem
Native `<select id="savedReportsSelect">` dropdown is clipped by flexbox in Chrome extension popup.
- It **used to work** → broke in `77d218b` (1.1.20) through `9d8e654` (1.1.41)
- Workaround: click inside, then pick option after population

## Root Cause Hypotheses (ordered by likelihood)

| # | Hypothesis | CSS Target | What to Try |
|---|------------|------------|-------------|
| 1 | `flex-wrap: nowrap` on `.toolbar` clips dropdown | `.toolbar` | Change to `flex-wrap: wrap` or `flex-wrap: initial` |
| 2 | `.toolbar-section` inner `display: flex` constrains select | `.toolbar-section` | Remove `display: flex` from `.toolbar-section` |
| 3 | Select is forced too wide by flex, exceeds popup bounds | `#savedReportsSelect` | Cap width or reduce `flex: 1 1 auto` |
| 4 | Missing `overflow: visible` on parent containers | `.toolbar`, `.toolbar-section` | Add `overflow: visible` |
| 5 | Chrome extension popup window boundary | N/A | Use custom dropdown or `<datalist>` |

## Tests

### Test 1: Wrap toolbar flex-wrap
**Change:** `.toolbar` `flex-wrap: nowrap` → `flex-wrap: wrap`
**Expected:** Select can flow freely below its flex row, dropdown extends
**Status:** NOT RUN

### Test 2: Remove inner flex from toolbar-section
**Change:** `.toolbar-section` remove `display: flex`
**Expected:** Select renders as normal block, dropdown escapes container
**Status:** NOT RUN

### Test 3: Cap savedReportsSelect width
**Change:** `#savedReportsSelect` add `max-width: 200px` (or similar)
**Expected:** Select doesn't exceed popup width dropdown won't clip
**Status:** NOT RUN

### Test 4: overflow: visible
**Change:** `.toolbar-section` add `overflow: visible`
**Expected:** Dropdown can extend beyond flex container bounds
**Status:** NOT RUN (tried but unsure of effect)

### Test 5: Switch to <datalist>
**Change:** Replace `<select>` with `<input list="reports">` + `<datalist>`
**Expected:** Datelist renders as overlay, not clipped
**Status:** NOT RUN