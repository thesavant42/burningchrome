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

## Notes

- Bundles are built with Rollup into `dist\`
- Extension version is defined in `manifest.json`
