# Burning Chrome CSS — Redundancy Diagram

## Architecture: Two Codebases Collided

```mermaid
graph TB
    subgen["══ TWO AGENT CODEBASES ══"]
    
    subgraph A["Agent A — Clean, Token-Driven Design"]
        A1[":root tokens"]
        A2[".toolbar — flex row"]
        A3[".link-list"]
        A4[".view-tabs"]
        A5["table + th/td"]
        A6[".badge-* system"]
        A7[".btn-action"]
        A8[".pagination"]
        A9[".modal-overlay/dialog"]
        A10[".btn-icon / .btn-edit / .btn-notes"]
        A11[".tree-view / .tree-node"]
        A12[".stats-card / .stats-grid"]
    end
    
    subgraph B["Agent B — Duplicated, Inline-Style Sprawl"]
        B1[":root tokens × 9 themes DUPLICATED"]
        B2[".toolbar + .toolbar-input-lg + .toolbar-input-sm + .toolbar-input"]
        B3[".view-tabs + .view-tabs-inline"]
        B4["table + #waybackTable DUPLICATED rules"]
        B5[".badge-* + .status-badge DUPLICATED"]
        B6[".btn-action + .cdx-btn + .open-btn DUPLICATED"]
        B7[".pagination + .pagination-inline DUPLICATED"]
        B8[".modal-overlay + .modal-dialog DUPLICATED"]
        B9[".btn-icon + .btn-icon-wide DUPLICATED"]
        B10[".dir-sort-btn + .btn-tree-expand DUPLICATED"]
        B11[".stats-* DUPLICATED with different class names"]
        B12[".theme-select + .page-header + .toolbar-section sprawl"]
    end
    
    A -->|"merged into same file"| MERGE
    B -->|"merged into same file"| MERGE
    
    subgraph MERGE["styles.css — 1600+ lines of merged mess"]
        direction TB
        M1["Lines 1-170: 9 theme blocks (mostly clean)"]
        M2["Lines 170-350: toolbar ×4 variants, table ×2, badges ×2 systems"]
        M3["Lines 350-600: pagination ×2, modal ×2, buttons ×5 variants"]
        M4["Lines 600-900: tree view, stats dashboard, inline style replacements"]
        M5["Lines 900-1600: more duplicates, utility classes, orphaned rules"]
    end
    
    MERGE --> FATE["Fate: 60% duplication, 3 flex systems competing, 2 badge systems, 2 pagination systems"]
```

## Duplication Matrix

```mermaid
matrix
    title "Component Duplication Map"
    column["Component"] & column["Agent A"] & column["Agent B"] & column["Merge Result"] & column["Should Keep"]
    row["Theme Tokens"] & "✓ 9 :root themes" & "—" & "✓ 9 :root themes" & "Agent A"
    row["Toolbar"] & "✓ .toolbar" & "✗ .toolbar-input-lg/sm" & "✗ .toolbar-input" & "Agent A + 1 input class"
    row["View Tabs"] & "✓ .view-tabs" & "✗ .view-tabs-inline" & "✗ 2 separate systems" & "Agent A + modifier"
    row["Table"] & "✓ table { }" & "✗ #waybackTable { }" & "✗ 2 identical rule sets" & "Agent A"
    row["Badges"] & "✓ .badge-*" & "✗ .status-badge-*" & "✗ 2 badge systems" & "Agent A"
    row["Buttons"] & "✓ .btn-action" & "✗ .cdx-btn .open-btn .delete-btn" & "✗ 4 button variants" & "Agent A + 1 accent class"
    row["Pagination"] & "✓ .pagination" & "✗ .pagination-inline" & "✗ 2 pagination systems" & "Agent A + modifier"
    row["Modal"] & "✓ .modal-overlay/dialog" & "—" & "✓ .modal-overlay/dialog" & "Agent A"
    row["Icon Buttons"] & "✓ .btn-icon" & "✗ .btn-icon-wide" & "✗ 2 classes for same thing" & "Agent A + width var"
    row["Stats Dashboard"] & "✓ .stats-card/grid" & "—" & "✓ .stats-card/grid" & "Agent A"
    row["Tree View"] & "✓ .tree-view/node" & "—" & "✓ .tree-view/node" & "Agent A"
    row["Theme Select"] & "—" & "✗ .theme-select sprawl" & "✗ Inline styles still used" & "New minimal class"
```

## Flex Box Chaos

```mermaid
graph LR
    subgraph F1["Flex System 1: .toolbar (Agent A)"]
        F1A["display: flex"]
        F1B["align-items: center"]
        F1C["gap: 0.75rem"]
        F1D["flex-wrap: nowrap"]
    end
    
    subgraph F2["Flex System 2: .toolbar-row-1/2 (Agent B)"]
        F2A["display: flex"]
        F2B["flex: 1 1 520px"]
        F2C["max-width: 720px"]
        F2D["flex-wrap: nowrap"]
    end
    
    subgraph F3["Flex System 3: .page-header + .toolbar-section (Agent B)"]
        F3A["display: flex"]
        F3B["margin-left: auto"]
        F3C["gap: 0.5rem"]
        F3D["flex: none"]
    end
    
    F1 --> CONFLICT["CONFLICT: 3 flex systems for the same toolbar layout"]
    F2 --> CONFLICT
    F3 --> CONFLICT
    
    CONFLICT --> RESULT["Result: dropdowns pushed around, inputs fighting for space, no single source of truth"]
```

## Complexity Reduction Path

```mermaid
graph TB
    subgraph BEFORE["BEFORE: 1600+ lines, ~60% duplication"]
        B1["9 theme blocks — OK"]
        B2["4 toolbar variants → 1"]
        B3["2 table systems → 1"]
        B4["2 badge systems → 1"]
        B5["4 button variants → 2"]
        B6["2 pagination systems → 1"]
        B7["2 modal systems → 1"]
        B8["3 flex systems → 1"]
        B9["Tree + Stats — OK, keep as-is"]
    end
    
    subgraph MINIMUM["MINIMUM: ~400 lines, zero duplication"]
        M1[":root tokens — themes"]
        M2[".toolbar — single flex row"]
        M3[".toolbar input/select/button — shared"]
        M4["table — single rule set"]
        M5[".badge-* — single system"]
        M6[".btn — single base + .btn-{accent} modifiers"]
        M7[".pagination — single system + .pagination--inline modifier"]
        M8[".modal — single system"]
        M9[".tree-view — unchanged"]
        M10[".stats — unchanged"]
    end
    
    subgraph FLARE["FLARE: ~100 lines, visual polish"]
        F1["Hover animations"]
        F2["Transition effects"]
        F3["Box-shadows on cards"]
        F4["Gradient accents"]
        F5["Custom scrollbar"]
        F6["Focus ring glow"]
    end
    
    BEFORE --> MINIMUM
    MINIMUM --> FLARE
    
    BEFORE -->|"1600 lines"| TOTAL
    MINIMUM -->|"~400 lines"| TOTAL
    FLARE -->|"~500 lines total"| TOTAL
    
    TOTAL["FINAL: ~500 lines, 70% reduction, zero duplication"]
```

## Line-by-Line Breakdown

```mermaid
graph LR
    subgraph L["styles.css Line Ranges"]
        direction TB
        L1["1-10: @font-face + sizing vars — 10 lines ✓"]
        L2["11-170: 9 theme palettes — 160 lines ✓"]
        L3["171-180: Reset — 10 lines ✓"]
        L4["181-230: Body, h1, a — 50 lines ✓"]
        L5["231-350: Toolbar ×4 variants — 120 lines ✗"]
        L6["351-400: Link list, tabs ×2 — 50 lines ✗"]
        L7["401-500: Table ×2 systems — 100 lines ✗"]
        L8["501-650: Badges ×2 systems — 150 lines ✗"]
        L9["651-750: Buttons ×4 variants — 100 lines ✗"]
        L10["751-900: Pagination ×2 — 150 lines ✗"]
        L11["901-1000: Modal ×2 — 100 lines ✗"]
        L12["1001-1100: Icon buttons, notes, edit — 100 lines ✓"]
        L13["1101-1200: Sortable headers, invert — 100 lines ✓"]
        L14["1201-1400: Stats dashboard — 200 lines ✓"]
        L15["1401-1550: Tree view — 150 lines ✓"]
        L16["1551-1600: Unified component styles — 50 lines ✗"]
    end
    
    L --> REDUCE["Reduce: Remove lines marked ✗, consolidate into shared rules"]
```

## Quick Reference: What to Delete

| Class/Selector | Lines | Reason | Replaced By |
|---|---|---|---|
| `.toolbar-input-lg` | ~15 | Duplicate sizing | `.toolbar-input` with width var |
| `.toolbar-input-sm` | ~15 | Duplicate sizing | `.toolbar-input` with width var |
| `.toolbar-input` | ~15 | Third variant | Merge into `.toolbar input` |
| `.view-tabs-inline` | ~25 | Duplicate tabs | `.view-tabs button` + `.active` |
| `#waybackTable` | ~60 | Duplicate table rules | `table` selector |
| `.status-badge`, `.status-*` | ~30 | Duplicate badges | `.badge-status-*` |
| `.cdx-btn`, `.open-btn`, `.delete-btn` | ~45 | Duplicate buttons | `.btn` + modifier classes |
| `.pagination-inline` | ~50 | Duplicate pagination | `.pagination` + modifier |
| `.btn-icon-wide` | ~15 | Same as .btn-icon | CSS custom property width |
| `.theme-select` + `.page-header` + `.toolbar-section` | ~40 | New Agent B sprawl | Single toolbar layout system |
| **Total to remove** | **~470 lines** | **60% of file** | **Consolidate to ~180 lines** |
