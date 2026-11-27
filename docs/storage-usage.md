# Cached-data overview

The disk button at the bottom of the right-hand control strip opens a read-only
per-layer IndexedDB overview. It includes hidden layers. Refresh reads current
values; Escape, the close button or a click outside dismisses the panel.

Layer owners register `storageLabel`, optional `storageId`, and `storageStores`
(`{database, store}` pairs) as OpenLayers layer properties. The control discovers
these when opened/refreshed, traversing layer groups and deduplicating owners.
Only the snow-season layer currently has IndexedDB stores: `chunks` (compressed
100×100 blocks, across cohorts) and `summaries` (legacy per-cell estimates).
Other layers show zero IndexedDB usage. Projection atlases use localStorage;
network tile caching and in-memory OpenLayers tiles are separate.

`storage/usage.js` scans registered object stores with read-only cursors. It
counts compressed buffer/blob lengths and UTF-8 JSON representations of legacy
summary values. Figures exclude record wrappers, keys, indexes and database
allocation overhead, which browsers do not expose per database. The separate
`navigator.storage.estimate()` figure is the browser's estimate for **all storage
on the origin**, including other caches and possibly other GitHub Pages projects.
It is not attributed to layers.

The scan runs in `storage/usage-worker.js`, outside map rendering, on open and
manual refresh. The worker and database handles close after each scan. Missing
databases/stores count as zero; opening the overview does not create databases
or upgrade versions. Unavailable storage is reported distinctly from zero.
No cache entries are removed or modified.

Verification:

```sh
node --test tests/storage-usage-node.mjs
node tests/storage-usage-browser.cjs
```

The optional browser test uses existing Playwright and OpenLayers installations.
Configure `PLAYWRIGHT_MODULE`, `OL_NODE_MODULES` and `CHROMIUM_PATH` as for the snow
chunk integration test. `STORAGE_TEST_ARTIFACTS` enables a screenshot. It verifies
no-database creation, exact chunk/legacy payload totals, refresh after writes,
zero usage for uncached layers, phone-sized layout and keyboard/outside dismissal.
