# Node reprojection check

Install the test-only dependencies once:

```
npm install --prefix tests/node-deps --no-audit --no-fund
```

From the repository root, run:

```
node tests/reproject-colors-node.mjs
```

Set `FROST_TEST_OUTPUT` to a directory to save the four rendered tiles as PNG images. The reprojection test uses OpenLayers' real `ReprojTile` canvas renderer and compares the pixels with each tile's planned bands, including its zoom limits. `zoom-contours-node.mjs` separately checks source-space masks against an independent distortion calculation at source zooms 6, 8, and 10. Canvas is a test-only dependency and is not loaded by the static app.
