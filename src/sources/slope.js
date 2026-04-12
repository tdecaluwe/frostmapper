import { Source } from '../core/cache.js'
import { Grid } from '../core/primitives.js'

function percentile90(values) {
  const sorted = values.slice().sort((a, b) => a - b)
  const idx = Math.floor(0.9 * (sorted.length - 1))
  return sorted[idx]
}

function computeSlopeCPU(elevation, width, height, cellSizeM, kernelCells, radiusCells) {
  const slopes = new Float32Array(width * height)

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col

      if (row < kernelCells || row >= height - kernelCells ||
          col < kernelCells || col >= width  - kernelCells) {
        slopes[idx] = 0
        continue
      }

      const center = elevation[idx]
      const north  = elevation[(row - kernelCells) * width + col]
      const south  = elevation[(row + kernelCells) * width + col]
      const east   = elevation[row * width + (col + kernelCells)]
      const west   = elevation[row * width + (col - kernelCells)]
      const D = kernelCells * cellSizeM

      const sN = Math.atan(Math.abs(center - north) / D) * (180 / Math.PI)
      const sS = Math.atan(Math.abs(center - south) / D) * (180 / Math.PI)
      const sE = Math.atan(Math.abs(center - east)  / D) * (180 / Math.PI)
      const sW = Math.atan(Math.abs(center - west)  / D) * (180 / Math.PI)
      slopes[idx] = Math.max(sN, sS, sE, sW)
    }
  }

  const windowed = new Float32Array(width * height)

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const rMin = Math.max(0, row - radiusCells)
      const rMax = Math.min(height - 1, row + radiusCells)
      const cMin = Math.max(0, col - radiusCells)
      const cMax = Math.min(width  - 1, col + radiusCells)
      const window = []

      for (let r = rMin; r <= rMax; r++) {
        for (let c = cMin; c <= cMax; c++) {
          const dr = r - row
          const dc = c - col
          if (dr * dr + dc * dc <= radiusCells * radiusCells) {
            window.push(slopes[r * width + c])
          }
        }
      }

      windowed[row * width + col] = window.length > 0 ? percentile90(window) : 0
    }
  }

  return windowed
}

export class SlopeSource extends Source {
  #elevationSource
  #kernelMeters
  #radiusMeters

  constructor({ id, elevationSource, kernelMeters, radiusMeters, transform, persist, _store }) {
    super({ id, transform, dtype: 'float32', persist: persist ?? false, _store })
    this.#elevationSource = elevationSource
    this.#kernelMeters    = kernelMeters ?? 50
    this.#radiusMeters    = radiusMeters ?? 100
  }

  async compute(tileId, signal) {
    let elevGrid = null
    for await (const chunk of this.#elevationSource.get(tileId.extent, tileId.cellSize, signal)) {
      elevGrid = chunk.grid
      break
    }
    if (!elevGrid) return null

    const { data, width, height } = elevGrid
    const cellSizeM   = tileId.cellSize
    const kernelCells = Math.max(1, Math.round(this.#kernelMeters / cellSizeM))
    const radiusCells = Math.max(1, Math.round(this.#radiusMeters / cellSizeM))

    let result
    if (typeof globalThis.navigator !== 'undefined' && globalThis.navigator?.gpu) {
      try {
        result = await this.#computeGPU(data, width, height, cellSizeM, kernelCells, radiusCells)
      } catch {
        result = computeSlopeCPU(data, width, height, cellSizeM, kernelCells, radiusCells)
      }
    } else {
      result = computeSlopeCPU(data, width, height, cellSizeM, kernelCells, radiusCells)
    }

    return new Grid({ data: result, width, height, dtype: 'float32' })
  }

  async #computeGPU(elevation, width, height, cellSizeM, kernelCells, radiusCells) {
    const adapter = await globalThis.navigator.gpu.requestAdapter()
    if (!adapter) throw new Error('No WebGPU adapter')
    const device = await adapter.requestDevice()

    const inputBuf = device.createBuffer({
      size:  elevation.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(inputBuf, 0, elevation)

    const outputBuf = device.createBuffer({
      size:  width * height * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })

    const readBuf = device.createBuffer({
      size:  width * height * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    })

    const uniformData = new Float32Array([width, height, cellSizeM, kernelCells, radiusCells])
    const uniformBuf  = device.createBuffer({
      size:  uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(uniformBuf, 0, uniformData)

    const shaderModule = device.createShaderModule({ code: SLOPE_WGSL })
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' },
    })

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: inputBuf  } },
        { binding: 1, resource: { buffer: outputBuf } },
        { binding: 2, resource: { buffer: uniformBuf } },
      ],
    })

    const encoder = device.createCommandEncoder()
    const pass    = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8))
    pass.end()
    encoder.copyBufferToBuffer(outputBuf, 0, readBuf, 0, width * height * 4)
    device.queue.submit([encoder.finish()])

    await readBuf.mapAsync(GPUMapMode.READ)
    const result = new Float32Array(readBuf.getMappedRange().slice(0))
    readBuf.unmap()

    inputBuf.destroy()
    outputBuf.destroy()
    readBuf.destroy()
    uniformBuf.destroy()
    device.destroy()

    return result
  }
}

const SLOPE_WGSL = `
struct Uniforms {
  width:        f32,
  height:       f32,
  cellSizeM:    f32,
  kernelCells:  f32,
  radiusCells:  f32,
};

@group(0) @binding(0) var<storage, read>       elevation: array<f32>;
@group(0) @binding(1) var<storage, read_write> slopes:    array<f32>;
@group(0) @binding(2) var<uniform>             u:         Uniforms;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let col = id.x;
  let row = id.y;
  let w   = u32(u.width);
  let h   = u32(u.height);
  let k   = u32(u.kernelCells);

  if (col >= w || row >= h) { return; }
  let idx = row * w + col;

  if (row < k || row >= h - k || col < k || col >= w - k) {
    slopes[idx] = 0.0;
    return;
  }

  let center = elevation[idx];
  let north  = elevation[(row - k) * w + col];
  let south  = elevation[(row + k) * w + col];
  let east_  = elevation[row * w + col + k];
  let west_  = elevation[row * w + col - k];
  let D = u.kernelCells * u.cellSizeM;

  let sN = atan(abs(center - north) / D) * (180.0 / 3.14159265);
  let sS = atan(abs(center - south) / D) * (180.0 / 3.14159265);
  let sE = atan(abs(center - east_) / D) * (180.0 / 3.14159265);
  let sW = atan(abs(center - west_) / D) * (180.0 / 3.14159265);
  slopes[idx] = max(max(sN, sS), max(sE, sW));
}
`
