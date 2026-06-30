
1. `#viewTableBtn` - the button to switch to file list view
2. `#bucketTable` - the table element
3. Table columns: checkbox, key, size, last modified, actions
4. Various badges and action buttons

Let me give the user a clean, simple list.


Here's the list of every element and style used by the file list view tab:

**HTML Elements:**
- `#viewTableBtn` - button to toggle file list view
- `#bucketTable` - the table element
- `#bucketBody` - tbody for rows
- `<col>` elements with inline widths: `.col-check`, `.col-url`, `.col-size`, `.col-date`, `.col-actions`

**CSS Styles:**

| Selector | Property | Value | Purpose | Line Number |
|----------|----------|-------|-------|-------------|
| `table` | width | 100% | Full width container |  |
| `table` | border-collapse | collapse | Merge cell borders |  |
| `table` | font-size | 0.85rem | Base text size |  |
| `th, td` | padding | 0.4rem 0.6rem | Cell spacing |  |
| `th, td` | text-align | left | Left-align all cells |  |
| `th, td` | border-bottom | 1px solid rgba(248, 248, 242, 0.1) | Subtle row divider |  |
| `th` | background | #161619 | Header row background |  |
| `th` | color | var(--cyan) #fefeff | Header text color |  |
| `th` | position | sticky | Fixed header on scroll |  |
| `th` | top | 0 | Stick to top of viewport |  |
| `tr:hover` | background | rgba(255, 121, 198, 0.15) | Row hover highlight |  |
| `tr:hover` | box-shadow | inset 3px 0 0 var(--pink) #aa0014 | Left accent on hover |  |
| `tr.selected` | background | rgba(255, 121, 198, 0.2) | Selected row highlight |  |
| `tr.selected` | box-shadow | inset 3px 0 0 var(--pink) #aa0014 | Left accent when selected |  |
| `.col-check` | text-align | center | Center checkbox column |  |
| `.col-check` | white-space | nowrap | Prevent wrapping |  |
| `.col-url` | text-align | left | Left-align URL column |  |
| `.col-url` | word-break | break-all | Wrap long URLs |  |
| `.col-url a` | word-break | break-all | Wrap link URLs |  |
| `.col-date` | white-space | nowrap | Prevent date wrapping |  |
| `.col-actions` | white-space | nowrap | Prevent action button wrapping |  |
| `.col-actions` | text-align | center | Center action buttons |  |
| `.badge-date` | display | inline-block | Inline block display |  |
| `.badge-date` | width | 100px | Fixed badge width |  |
| `.badge-date` | padding | 3px 6px | Badge internal spacing |  |
| `.badge-date` | background | var(--bg-alt) #161619 | Badge background |  |
| `.badge-date` | color | var(--fg) #ffffff | Badge text color |  |
| `.badge-date` | border-radius | 3px | Slight rounded corners |  |
| `.badge-date` | font-size | 0.7rem | Small badge text |  |
| `.badge-date` | font-family | 'Courier New', monospace | Monospace font for dates |  |
| `.badge-action` | display | inline-block | Inline block display |  |
| `.badge-action` | width | 44px | Fixed button width |  |
| `.badge-action` | padding | 3px 0 | Vertical padding only |  |
| `.badge-action` | margin | 0 2px | Horizontal spacing between buttons |  |
| `.badge-action` | border-radius | 3px | Slight rounded corners |  |
| `.badge-action` | font-size | 0.7rem | Small button text |  |
| `.badge-action` | font-family | 'Courier New', monospace | Monospace font for buttons |  |
| `.badge-action-archive` | background | rgba(139, 233, 253, 0.2) | Archive badge background tint |  |
| `.badge-action-archive` | color | var(--cyan) #fefeff | Archive badge text color |  |
| `.badge-action-live` | background | rgba(80, 250, 123, 0.2) | Live badge background tint |  |
| `.badge-action-live` | color | var(--green) #920314 | Live badge text color | |
| `.btn-action` | border | 1px solid var(--purple) #ffffff | Button border |  |
| `.btn-action` | border-radius | 3px | Slight rounded corners |  |
| `.btn-action` | font-size | 0.7rem | Small button text |  |
| `.btn-action` | color | var(--purple) #ffffff | Button text color |  |
| `.btn-action:hover` | background | var(--purple) #ffffff | Button hover background |  |
| `.btn-action:hover` | color | var(--bg) #141417 | Button hover text color |  |

**Inline styles from JS:**

- `<col width="...">` - column widths set dynamically
- `style="background: ..."` - row background for status codes
- `style="color: ..."` - status text color