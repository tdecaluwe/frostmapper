const {sqrt, sign, cos, sin, tan, atan, atan2, hypot, PI} = Math;
const degrees = 180/PI, radians = PI/180, halfPi = PI/2;


export class Coords {
  constructor(x, y) {
    this.x = x
    this.y = y
    Object.seal(this)
  }

  to(Target) {
    const {x, y} = Target.forward(this.constructor.inverse(this));
    return new Target(x, y);
  }

  static from(point) {
    return point.to(this);
  }
}

export class WGS84Coords extends Coords {
  static forward ({x: lon, y: lat}) {
    return {x: lon*degrees, y: lat*degrees};
  }

  static inverse ({x: lon, y: lat}) {
    return {x: lon*radians, y: lat*radians};
  }
}

export class Stereographic extends Coords {
    static forward ({x: lon, y: lat}) {
        const r = tan(0.5 * (halfPi - lat));
        return {x: sin(lon) * r, y: -cos(lon) * r};
    }
    static inverse ({x, y}) {
        return {x: atan2(x, -y), y: halfPi - 2 * atan(hypot(x, y))};
    }
};

export class NormalizedPeirceCoords extends Coords {
  static k = 0.7627597635018135;  // forward map derivative at the origin
  static kk = 1 / NormalizedPeirceCoords.k;

  static forward(point) {
    const k = NormalizedPeirceCoords.k;

    let {x, y} = Stereographic.forward(point);

    // ********** DOMAIN REDUCTION
  
    const sx = sign(x) || sign(1/x); // -0 -> -1; +0 -> +1
    const sy = sign(y) || sign(1/y);

    const r2 = x*x + y*y;
    // short circuit for points near the poles
    if (r2 > 1e8) {
      const z = new Float64Array(2);
      if (r2 === 0) {z[0] = sx; z[1] = sy}
      else {z[0] = sx - y * (k/r2); z[1] = sy - x * (k/r2)}
      return {x: z[0], y: z[1]};
    }
    if (r2 < 1e-8) {
      const z = new Float64Array(2);
      z[0] = k*x; z[1] = k*y;
      return {x: z[0], y: z[1]}
    }

    x *= sx; y *= sy; // reflect into positive quadrant

    const rbig = r2 > 1;
    if (rbig) { const d = 1/r2; x *= d; y *= d; } // invert across unit circle
    const ybig = y > x;
    if (ybig) { const t = x; x = y; y = t; } // reflect across line y = x
    
    // ********** MAP FUNDAMENTAL PIE SLICE
    
    const z = qmap(x, y); // apply rational approximation
    x = z[0]; y = z[1];
    // at this point, x + iy == (1 - z)^2, where z is the
    // output in the triangle with vertices [0, 1, (1+i)/2]

    // x + iy = 1 - complex_sqrt(x + iy)
    { const r = sqrt(x*x + y*y);
      y = sqrt(0.5 * (r - x));
      x = 1 - sqrt(0.5 * (r + x));
    }
    
    y *= (y >= 0); // don’t let the projection out of bounds
    
    // ********** REFLECT ACCORDING TO EARLIER DOMAIN REDUCTIONS
    
    if (ybig) { const t = x; x = y; y = t; }
    if (rbig) { const t = x; x = 1 - y; y = 1 - t; }
    return {x: x * sx, y: y * sy};
  }

  static inverse({x, y}) {
    const kk = NormalizedPeirceCoords.kk;

    // ********** DOMAIN REDUCTION

    // reduce areas outside [-1, 1] square and reflect to positive quadrant
    const xg = Math.round(0.5*x);
    const yg = Math.round(0.5*y);
    x -= 2*xg; y -= 2*yg;
    
    let sx = sign(x) || sign(1/x);
    let sy = sign(y) || sign(1/y);
    
    x *= sx; y *= sy;
    const g = 2 * ((xg + yg) & 1);
    sx *= 1 - g; sy *= 1 - g;
    
    const rbig = x + y > 1;
    if (rbig) { const t = x; x = 1 - y; y = 1 - t; } // invert across line x + y = 1

    const ybig = y > x;
    if (ybig) { let t = x; x = y; y = t; } // reflect across line y = x
    
    // short circuit for points near the poles
    let z;
    if (x + y < 1e-4) {
      x *= kk; y *= kk;
      z = new Float64Array(2);
    } else {
      
      // ********** MAP FUNDAMENTAL ISOCELES RIGHT TRIANGLE
      
      // x + iy = (1 - x - iy)^2
      { const a = 1 - x;
        x = a*a - y*y;
        y = -2*a*y;
      }
      z = qimap(x, y); // apply rational approximation
      x = z[0]; y = z[1];
    }
    
    // ********** REFLECT ACCORDING TO EARLIER DOMAIN REDUCTIONS
    
    if (ybig) { const t = x; x = y; y = t; }
    if (rbig) {
      const r = 1 / (x*x + y*y);
      if (r === Infinity) {x = y = 1;}
      x *= r; y *= r;
    }
    return Stereographic.inverse({x: x * sx, y: y * sy});
  }
}

export function registerPeirce(proj4, {k_0 = PEIRCE_METERS_PER_UNIT} = {}) {
  proj4.Proj.projections.add({
    names: ['peirce', 'peirce_q'],
    init() {
      this.k0 = this.k0 ?? 1
    },
    forward(point) {
      const {x, y} = NormalizedPeirceCoords.forward(point)
      return {x: x * this.k0, y: y * this.k0}
    },
    inverse({x, y}) {
      return NormalizedPeirceCoords.inverse({x: x / this.k0, y: y / this.k0})
    },
  })
  proj4.defs(PEIRCE_CODE, '+proj=peirce_q +k_0=' + k_0 + ' +units=m +no_defs')
  return PEIRCE_CODE
}

export function registerAffine(proj4) {
  proj4.Proj.projections.add({
    names: ['affine'],
    init() {
      this.s11 = this.s11 ?? 1
      this.s12 = this.s12 ?? 0
      this.s21 = this.s21 ?? 0
      this.s22 = this.s22 ?? 1
      this.x0 = this.x0 ?? 0
      this.y0 = this.y0 ?? 0
    },
    forward(point) {
      return {
        x: this.s11 * point.x + this.s12 * point.y + this.x0,
        y: this.s21 * point.x + this.s22 * point.y + this.y0,
      }
    },
    inverse(point) {
      const det = this.s11 * this.s22 - this.s12 * this.s21
      const x = point.x - this.x0
      const y = point.y - this.y0
      return {
        x: (this.s22 * x - this.s12 * y) / det,
        y: (-this.s21 * x + this.s11 * y) / det,
      }
    },
  })
}

function splitPipelineSteps(projString) {
  return projString
    .split('+step')
    .slice(1)
    .map((step) => step.trim())
    .filter(Boolean)
}

export function registerPipeline(proj4) {
  proj4.Proj.projections.add({
    names: ['pipeline'],
    init() {
      this.steps = splitPipelineSteps(this.projStr).map((step) => proj4.Proj(step))
    },
    forward(point) {
      let current = {x: point.x, y: point.y}
      for (const step of this.steps) {
        current = step.forward(current)
      }
      return current
    },
    inverse(point) {
      let current = {x: point.x, y: point.y}
      for (let i = this.steps.length - 1; i >= 0; i -= 1) {
        current = this.steps[i].inverse(current)
      }
      return current
    },
  })
}

export function registerGrieger(proj4, {k_0 = PEIRCE_METERS_PER_UNIT} = {}) {
  proj4.defs(GRIEGER_CODE, {
    projName: 'pipeline',
    projStr: '+proj=pipeline +step +proj=ob_tran +o_proj=peirce_q +o_lat_p=-45 +o_lon_p=0 +o_scrollx=-0.25 +k_0=' + k_0 + ' +step +proj=affine +s11=-1 +s12=0 +s21=0 +s22=-1',
    title: 'Grieger Triptychial',
  })
  return GRIEGER_CODE
}

function reval(nodes, values, weights) {
  const n = nodes.length;

  return function reval(x, y) {

    // running total for numerator & denominator
    let px = 0, py = 0, qx = 0, qy = 0;

    for (let j = 0; j < n; j += 2) {
      // q += w_j / (z - z_j)
      // p += f_j * w_j / (z - z_j)
      const xj = x - nodes[j], yj = nodes[j+1] - y,
            wxj = weights[j], wyj = weights[j+1],
            fxj = values[j], fyj = values[j+1],
            dj = 1 / (xj*xj + yj*yj),
            qxj = dj * (wxj*xj - wyj*yj),
            qyj = dj * (wxj*yj + wyj*xj);
      px += fxj * qxj - fyj * qyj;
      py += fxj * qyj + fyj * qxj;
      qx += qxj, qy += qyj;
    }

    let d = 1 / (qx * qx + qy * qy),
        fx = (px * qx + py * qy) * d,
        fy = (py * qx - px * qy) * d;

    // Edge case where x + iy is one of the nodes; directly use value
    if (fx + fy !== fx + fy) { // true if x or y is NaN
      for (let j = 0; j < n; j += 2) {
        const xj = x - nodes[j], yj = nodes[j+1] - y;
        if ((xj === 0) & (yj === 0)) {
          fx = values[j]; fy = values[j+1];
          break;
        }
      }
    }

    const z = new Float64Array(2); z[0] = fx; z[1] = fy;
    return z;
  };

}

const qmap = reval(new Float64Array([
   2.841274295607302e-01,  0.000000000000000e+00,
   9.000701021270673e-01,  4.357451218969299e-01,
   8.307448759221154e-01,  0.000000000000000e+00,
   6.627533478425493e-02,  0.000000000000000e+00,
   7.867241040676948e-01,  6.173047740613080e-01,
   2.091012105576087e-01,  2.091012105576087e-01,
   9.908979498340043e-01,  1.346152035052754e-01,
   5.831630651834322e-01,  0.000000000000000e+00,
   5.823169918190614e-01,  5.823169918190614e-01,
   4.600717751287283e-01,  4.600717751287283e-01,
   1.175386486186337e-02,  1.175386486186337e-02
]), new Float64Array([
   6.133041957206595e-01,  0.000000000000000e+00,
   0.000000000000000e+00, -2.697288123328281e-01,
   1.073938602151508e-01,  0.000000000000000e+00,
   9.014510181710358e-01,  0.000000000000000e+00,
   2.775557561562891e-17, -4.121942774638293e-01,
   6.812551737310080e-01, -2.679456941323670e-01,
   6.938893903907228e-18, -7.874961347414625e-02,
   3.022540859025502e-01,  0.000000000000000e+00,
   1.462888136479623e-01, -4.892997915007359e-01,
   3.098769525555705e-01, -4.519881371374364e-01,
   9.820692497723584e-01, -1.776999432577847e-02
]), new Float64Array([
  -1.636735245315600e-01,  0.000000000000000e+00,
   4.576711314447485e-01,  2.606917127959570e-01,
   6.218685503420178e-02, -4.555806628111250e-01,
  -1.381933609058136e-02,  4.276799650123018e-02,
  -4.937289564091346e-02,  2.051307665996611e-01,
   1.469711063375004e-02,  8.532858482953236e-02,
   3.617212217993757e-01, -3.977678831392779e-02,
  -3.557001195121915e-01, -2.900841369992467e-01,
  -1.172277719642794e-01,  1.668340930233777e-01,
  -2.096148398952382e-01,  3.730691188900302e-02,
   1.313037843108833e-02, -1.261985295194955e-02
]));

const qimap = reval(new Float64Array([
   3.812877943853064e-01, -4.273098089263941e-01,
   5.862237343389646e-01,  0.000000000000000e+00,
  -1.387778780781446e-17, -1.136995103524485e-01,
   8.606531239202513e-01, -1.296381001431562e-01,
   1.486522213141997e-01, -4.889512585491770e-01,
   0.000000000000000e+00, -4.823196777396260e-01,
   2.870951833595923e-01,  0.000000000000000e+00,
   9.988582417584706e-01,  0.000000000000000e+00
]), new Float64Array([
   4.100042032428683e-01,  4.100042032428683e-01,
   3.069627780283768e-01,  0.000000000000000e+00,
   9.811562764314339e-01,  1.932158410151805e-01,
   9.134642598181811e-02,  9.134642598181811e-02,
   5.804469590593406e-01,  5.804469590593406e-01,
   7.234467769137209e-01,  6.903801568506648e-01,
   6.003103515806268e-01,  0.000000000000000e+00,
   7.486527117271623e-04,  0.000000000000000e+00
]), new Float64Array([
  -4.890921447242968e-01,  0.000000000000000e+00,
   1.202130864468549e-01, -5.417179517038786e-01,
   7.026464276190582e-02,  9.713636303667084e-02,
  -2.352682166111389e-01,  1.787326777655438e-01,
  -2.036311348372837e-02,  3.592547702079886e-01,
   1.050424248615412e-01, -4.007475368880814e-02,
   4.463703363841267e-01,  3.820014896672286e-02,
   2.833107518816005e-03, -9.153116096530403e-02,
]));


export const PEIRCE_CODE = 'EPSG:PEIRCE'
export const GRIEGER_CODE = 'EPSG:GRIEGER'
export const PEIRCE_WORLD_EXTENT = [-180, -90, 180, 90]
export const PEIRCE_SQUARE_EXTENT = [-1, -1, 1, 1]
export const PEIRCE_METERS_PER_UNIT = 10_000_000
export const PEIRCE_EXTENT = PEIRCE_SQUARE_EXTENT.map((value) => value * PEIRCE_METERS_PER_UNIT)
export const GRIEGER_EXTENT = PEIRCE_EXTENT

export function projectLonLatToPeirce(lonLat) {
  const projected = NormalizedPeirceCoords.forward({x: lonLat[0] * radians, y: lonLat[1] * radians})
  return [projected.x * PEIRCE_METERS_PER_UNIT, projected.y * PEIRCE_METERS_PER_UNIT]
}

export function unprojectPeirceToLonLat(coordinate) {
  const inverted = NormalizedPeirceCoords.inverse({x: coordinate[0] / PEIRCE_METERS_PER_UNIT, y: coordinate[1] / PEIRCE_METERS_PER_UNIT})
  return [inverted.x * degrees, inverted.y * degrees]
}
