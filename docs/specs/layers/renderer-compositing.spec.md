# Spec: Renderer Compositing and WebGL Blending

## Purpose

This spec defines the exact WebGL blending pipeline used by `RasterRenderer`, including the premultiplied alpha requirement imposed by MapLibre, the fragment shader fix required to produce correct compositing output, and the expected visual behaviour when multiple raster layers are stacked on screen.

This spec supplements `core/layer.spec.md` — it does not duplicate the upload interface or mesh generation sections.

---

## MapLibre blending contract

MapLibre GL JS sets the following WebGL blend state before calling a Custom Layer's `render()` method:

```
gl.enable(gl.BLEND)
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
```

This is the **premultiplied alpha** blend equation. It expects the fragment shader to output **premultiplied alpha** — i.e. `gl_FragColor.rgb` must already have alpha applied:

```
output.rgb = src.rgb * src.alpha + dst.rgb * (1 - src.alpha)
```

With premultiplied alpha, `src.rgb` is already `unPremultRGB * alpha`, so MapLibre can use `ONE` for the source factor without any additional multiply.

**Critical requirement**: the `RasterRenderer` fragment shader MUST premultiply alpha before writing `gl_FragColor`. Failure to do so produces incorrect blending — colors appear too bright or oversaturated where they composite over the basemap.

---

## Fragment shader — premultiplied alpha output

### Soft filter

The soft filter maps a cell value to a colour with opacity derived from the normalised value:

```glsl
float normalized = clamp((value - valueMin) / (valueMax - valueMin), 0.0, 1.0);
vec4 straight = hslaToRgba(hue, 1.0, 0.5, normalized);
// Premultiply before output:
gl_FragColor = vec4(straight.rgb * straight.a, straight.a);
```

At `normalized = 0` (cell value at or below `valueMin`): `gl_FragColor = vec4(0.0)` — fully transparent, no contribution to the basemap composite.

At `normalized = 1` (cell value at or above `valueMax`): `gl_FragColor = vec4(rgb, 1.0)` with `rgb` premultiplied — fully opaque hue.

### Hard filter

The hard filter outputs a 50% grey overlay for cells above the threshold:

```glsl
if (value > threshold) {
  // straight: vec4(0.5, 0.5, 0.5, 0.5)
  // premultiplied: rgb *= a → vec4(0.25, 0.25, 0.25, 0.5)
  gl_FragColor = vec4(0.25, 0.25, 0.25, 0.5);
} else {
  gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
}
```

Cells below the threshold are fully transparent.

### No-data / edge handling

- `value == 0.0` with `valueMin == 0.0`: `normalized = 0` → `alpha = 0` → transparent. Correct.
- `valueMin == valueMax`: the division `(value - valueMin) / (valueMax - valueMin)` produces `0/0 = NaN`. The `clamp()` call on NaN returns 0.0 in GLSL (NaN comparisons are false). Result: transparent pixel. Correct.
- Values outside `[valueMin, valueMax]`: `clamp()` pins to 0 or 1. No clipping artefacts.

---

## Full fragment shader (complete, correct)

```glsl
precision mediump float;
uniform sampler2D chunkData;
uniform int layerType;     // 0 = soft filter, 1 = hard filter
uniform float hue;         // degrees 0–360 (soft filter only)
uniform float valueMin;    // from valueRange.from (soft filter only)
uniform float valueMax;    // from valueRange.to (soft filter only)
uniform float threshold;   // hard filter threshold
varying vec2 uv;

vec4 hslaToRgba(float h, float s, float l, float a) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float hp = h / 60.0;
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 rgb;
  if      (hp < 1.0) rgb = vec3(c, x, 0.0);
  else if (hp < 2.0) rgb = vec3(x, c, 0.0);
  else if (hp < 3.0) rgb = vec3(0.0, c, x);
  else if (hp < 4.0) rgb = vec3(0.0, x, c);
  else if (hp < 5.0) rgb = vec3(x, 0.0, c);
  else               rgb = vec3(c, 0.0, x);
  float m = l - c / 2.0;
  return vec4(rgb + m, a);
}

void main() {
  float value = texture2D(chunkData, uv).r;

  if (layerType == 0) {
    // Soft filter
    float normalized = clamp((value - valueMin) / (valueMax - valueMin), 0.0, 1.0);
    vec4 straight = hslaToRgba(hue, 1.0, 0.5, normalized);
    // Premultiply alpha for MapLibre's blendFunc(ONE, ONE_MINUS_SRC_ALPHA)
    gl_FragColor = vec4(straight.rgb * straight.a, straight.a);
  } else {
    // Hard filter — 50% grey overlay, premultiplied
    gl_FragColor = value > threshold
      ? vec4(0.25, 0.25, 0.25, 0.5)
      : vec4(0.0, 0.0, 0.0, 0.0);
  }
}
```

---

## Texture parameters

Every texture upload MUST set wrap and filter parameters to avoid edge artefacts:

```javascript
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
```

Rationale for `CLAMP_TO_EDGE`:
- Our chunk textures are not power-of-2 sized (e.g. 512×512 cells at stride=1, but may vary).
- `REPEAT` wrap on non-power-of-2 textures is undefined in WebGL1. `CLAMP_TO_EDGE` is always safe.
- Without `CLAMP_TO_EDGE`, seam artefacts appear at chunk boundaries where UV coordinates reach exactly 0.0 or 1.0.

Rationale for `LINEAR` filtering:
- Soft filter layers display continuous gradient data (temperature, snow depth). Bilinear filtering reduces visible cell boundaries and produces a smooth map appearance.
- Hard filter layers also use `LINEAR` — the binary hard/soft decision is made per-cell in the source (the texture value is already binary), so filtering at the texture sample level only slightly softens the boundary, which is acceptable and visually consistent.

### Float textures (float32 dtype)

Float textures require the `OES_texture_float` extension in WebGL1. The renderer requests it lazily on the first float32 upload:

```javascript
const ext = gl.getExtension('OES_texture_float')
if (!ext) {
  console.warn('OES_texture_float not available — float32 chunks may not render correctly')
}
```

If the extension is unavailable, the `texImage2D` call with `gl.FLOAT` is a no-op (undefined behaviour in WebGL1). The layer will appear blank. No crash.

---

## Shader compile error extraction

If shader compilation fails, the renderer must extract and throw the info log:

```javascript
if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
  const log = gl.getShaderInfoLog(shader)
  throw new Error(`Shader compile failed: ${log}`)
}
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  const log = gl.getProgramInfoLog(program)
  throw new Error(`Shader link failed: ${log}`)
}
```

---

## Layer compositing order

Layers are drawn in registration order (back to front). `LayerFactory` registers layers in this order:

1. Soft filters (snow season, winter temp, melt risk) — rendered first, behind hard filters
2. Hard filters (slope, road access) — rendered above soft filters

Annotation layers (transport stops, isochrones, road access) are GeoJSON MapLibre layers — they are added via `map.addLayer()` after the `RasterRenderer` custom layer and therefore always appear on top.

**Visual stacking semantics:**

- Multiple soft filter layers: each composites over the previous via premultiplied alpha blending. A cell covered by two soft filters shows the top layer's colour blended over the bottom layer's colour over the basemap. There is no additive blending — standard alpha-over compositing.
- Multiple hard filter layers: each adds an independent 50% grey overlay. A cell covered by two hard filters will show two 50% grey overlays composited, resulting in a darker grey. This is expected — it indicates the cell fails two hard criteria.
- Hard filter over soft filter: hard filter's grey blends over the soft filter's hue, partially obscuring it. The area is identifiably grey (hard-filtered) while still showing the underlying soft filter colour through the 50% opacity.

---

## Test cases

### Test 1: soft filter outputs premultiplied alpha

Write a test that verifies the fragment shader source string contains `straight.rgb * straight.a` (or equivalent premultiplication) before assignment to `gl_FragColor`. The test should extract `FRAGMENT_SHADER_SRC` from the renderer module and check for the premultiplication pattern.

### Test 2: hard filter output is premultiplied (0.25 not 0.5)

Verify the hard filter branch outputs `vec4(0.25, 0.25, 0.25, 0.5)` — not `vec4(0.5, 0.5, 0.5, 0.5)`. The RGB channels must be 0.25 (= 0.5 × 0.5 premultiplied), not 0.5.

### Test 3: CLAMP_TO_EDGE set on texture upload

Call `renderer.upload(grid, vertices, getParams)` with mock GL. Verify `gl.texParameteri` was called with `gl.CLAMP_TO_EDGE` for both `TEXTURE_WRAP_S` and `TEXTURE_WRAP_T`.

### Test 4: OES_texture_float requested on float32 upload

Call `renderer.upload(float32Grid, ...)`. Verify `gl.getExtension` was called with `'OES_texture_float'`.

### Test 5: shader compile error propagates info log

Configure mock GL to return `false` from `getShaderParameter`. Verify `onAdd()` throws an error containing the shader info log string.

### Test 6: shader link error propagates info log

Configure mock GL to return `true` from `getShaderParameter` but `false` from `getProgramParameter`. Verify `onAdd()` throws an error containing the program info log string.

### Test 7: zero valueRange does not crash

Upload a soft filter chunk and call `render()` with `valueMin == valueMax`. Verify no exception is thrown and the render call completes.
