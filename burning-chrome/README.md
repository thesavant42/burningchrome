# Burning Chrome

Chrome extension for investigating public web data with quick, local reports.

## What it does

- Wayback Machine timemap reports
- crt.sh subdomain discovery
- Bucket indexing with table, tree, and stats views
- Saved reports and export helpers

## Dev

```bash
cd burning-chrome
npm install
npm run build
```

Load the `burning-chrome` folder as an unpacked extension in Chrome.

## Theme Workflow (Quick)

Use this when adding a new palette, for example Doki Rory.

1. Add a theme block in `styles.css` using the same variable keys:

```css
:root.theme-mytheme {
	--bg: #141417;
	--bg-alt: #1c1c22;
	--fg: #f2edf0;
	--comment: #9e8a90;
	--cyan: #d6d9e7;
	--green: #df8c96;
	--orange: #d49a7b;
	--pink: #b53241;
	--purple: #b7a4c8;
	--red: #8b2b36;
	--yellow: #e1bf9f;
}
```

2. Add an option to every `themeSelect` dropdown in these files:

- `landing.html`
- `buckets.html`
- `report.html`
- `config.html`
- `domains.html`
- `poi.html`
- `github.html`
- `dockerhub.html`
- `creds.html`

Example option:

```html
<option value="mytheme">My Theme</option>
```

3. Theme names must match exactly:

- CSS class: `theme-mytheme`
- option value: `mytheme`

`theme.js` automatically applies `theme-<value>` and persists it via `localStorage`, so no JS changes are needed if names match.

4. Build and verify:

```powershell
& "C:\Program Files\nodejs\npm.cmd" --prefix "c:\Users\jbras\GitHub\burningchrome\burning-chrome" run build
```

5. Test in UI:

- Reload extension
- Select the new theme from any page
- Confirm it persists after navigation and refresh
- Confirm contrast/readability in table headers, buttons, links, and stats cards

## Notes

- Bundles are built with Rollup into `dist\`
- Extension version is defined in `manifest.json`
