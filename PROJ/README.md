# PROJ renderer

Run:

```bash
./render.sh "+proj=pipeline +step +proj=ob_tran +o_proj=peirce_q +o_lat_p=-45 +o_lon_p=45 +o_scrollx=-0.25 +step +proj=affine +s11=-1 +s12=0 +s21=0 +s22=-1"
```

This clones the upstream PROJ docs plotting path: real `proj`, real `docs/plot/plot.py`, and the upstream land GeoJSON.
