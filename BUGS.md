# Bugs

## Bug # 1 - saved report selector cannot expand

- Cannot expand `savedReportsSelect` when clicked, despite being filled with over 100 reports.
- is constrained by parent container `savedReportsContainer`?

![before the first click](/image-001 firstclick.png)

If I try to use the dropdown, thw dropdown is hidden behind something in the parent container. The menu unfurls but only a sliver of 1 record is visible through the gap.

However, if I then click the toolbar again, it will populate correctly and work.

![Second Click is fine](/image-002 SECOND CLICK copy.png)

### Solution Plan

- Remove whatever attribute prevents the menu from oepning.
- Link to the Buckets html page from the extension button landing page

---

## Bug # 2 - Extension landing page

- The extension landing page, which is accessed by clicking the extension icon, does not link to the buckets feature.
- The only way to actually launch a bucket is to use the context menu:
  - Right click -> select Burning Chrome -> import bucket xml.
- The Theme selector is not consistent with the Buckets page, should be on the **RIGHT** side of the layout.

