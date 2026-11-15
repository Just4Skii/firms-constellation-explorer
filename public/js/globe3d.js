/**
 * FIRMS CONSTELLATION INTELLIGENCE — GPU-ACCELERATED NASA EYES 3D ENGINE (globe3d.js)
 * Locked 60 FPS architecture:
 *  - Dedicated WebGL Ray-Cast Textured Sphere (#eyesWebGLCanvas) using real NASA Blue Marble &
 *    VIIRS Black Marble 2048x1024 textures + Fresnel Rayleigh Atmosphere (~0.25 ms GPU / ~0.01 ms CPU)
 *  - Fixed-size cached fallback sphere (never reallocated during zoom!) if WebGL is unavailable
 *  - Transparent 2D Overlay (#eyesGlobeCanvas) rendering only the 7 pre-computed orbital paths,
 *    LOD-capped single-date fire sprites (~160–420 blits), fire event markers, and zoom reticle
 *  - Retrograde (Backwards) Earth Rotation when moving backward in time; Prograde when moving forward
 */
(function (global) {
  'use strict';

  const DEG2RAD = Math.PI / 180;
  const TWO_PI = Math.PI * 2;

  class FIRMSGlobe3D {
    constructor(canvasId, tooltipId) {
      this.canvas = document.getElementById(canvasId);
      this.webglCanvas = document.getElementById('eyesWebGLCanvas');
      this.tooltip = document.getElementById(tooltipId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d', { alpha: true });

      // Camera spherical orientation (centered on Africa fire belt)
      this.rotLon = 22.0;
      this.rotLat = -12.0;
      this.zoom = 1.12;
      this.targetLon = 22.0;
      this.targetLat = -12.0;
      this.targetZoom = 1.12;

      // Continuous rotation & smooth time-travel velocity interpolation
      this.velLon = 0;
      this.velLat = 0;
      this.spinDirection = 1; // +1 = forward in time (prograde), -1 = backward in time (retrograde)
      this.activeYear = 2026;
      this.baseSpinDegPerSec = 4.2;
      this.currentSpinVel = -4.2;
      this.spinBoostDegPerSec = 0;
      this.spinBoostUntil = 0;
      this.isDragging = false;
      this.dragMoved = false;
      this.dragStartX = 0;
      this.dragStartY = 0;
      this.lastMouseMoveTime = 0;
      this.pauseSpinUntil = 0;
      this.autoSpin = true;
      this.spinDegPerSec = 4.2;

      this.projectionMode = '3D';
      this.earthStyle = 'visible_earth'; // 'visible_earth' | 'cobalt_night'
      this.showOrbits = true;
      this.showEvents = true;

      // Fixed-size fallback sphere cache (rebuilt ONLY if earthStyle switches, never per zoom frame)
      this._sphereCache = document.createElement('canvas');
      this._sphereCacheStyle = '';

      this.compiledPolygons = [];
      this.allDayPoints = [];
      this.metricMode = 'count';
      this.activePlatforms = new Set(['Terra', 'Aqua', 'NOAA-20', 'NOAA-21']);
      this.selectedFireZone = null;

      this.renderedScreenPoints = [];
      this.renderedSatelliteNodes = [];
      this.renderedEventPins = [];
      this.onSelectSatellite = null;
      this.onSelectEvent = null;
      this.onSelectFireCluster = null;
      this.onZoomThresholdReached = null;

      this.startTime = performance.now();
      this.lastFrameTime = this.startTime;

      this.sprites = this._buildOffscreenSprites();
      this.nightCities = this._compileNightCities();
      this.orbitSteps = 64;
      this.satellites = this._initSatellites();

      // Load NASA Blue Marble & Black Marble 2048x1024 base textures + high-res satellite tile streamer
      this.earthImages = { visible_earth: null, cobalt_night: null };
      this._tileCache = new Map();
      this._inFlightTiles = 0;
      this._maxInFlightTiles = 12;
      this._detailGridN = 8;
      this._detailTilePx = 256;
      this._detailAtlasCanvas = document.createElement('canvas');
      this._detailAtlasCanvas.width = this._detailGridN * this._detailTilePx;
      this._detailAtlasCanvas.height = this._detailGridN * this._detailTilePx;
      this._detailAtlasCtx = this._detailAtlasCanvas.getContext('2d');
      this._detailWindowKey = '';
      this._detailDirty = false;
      this._detailMercBox = [0, 0, 1, 1];
      this.glState = this._initWebGL();
      this._loadEarthTextures();

      // Year-Tagged Documented Fire Events (FIRMS Detection Coordinates & Case Coordinates, Africa-primary + Global Benchmarks)
      // At launch (2026) only 2026 events display; traveling backward in time reveals prior years' historical incidents.
      this.allGlobeEvents = [
        {
          id: 'kalahari_molopo',
          year: 2026,
          incidentDate: '2026-11-08',
          title: 'Molopo Kalahari Peak Hotspot',
          regionName: 'Southern Africa · Botswana / South Africa Border',
          subtitle: 'MODIS Pixel-Center Peak 2,050.6 MW (-20.74°, 24.57°) · 2026-11-08',
          lat: -20.7354,
          lon: 24.5662,
          sinLat: Math.sin(-20.7354 * DEG2RAD),
          cosLat: Math.cos(-20.7354 * DEG2RAD),
          regionId: 'saf',
          biome: 'kalahari_savanna',
          peakCountDay: '2026-11-08',
          peakFrpDay: '2026-11-07',
          maxFrpMw: 29839.4,
          clusters1km: 412,
        },
        {
          id: 'central_kalahari_frp',
          year: 2026,
          incidentDate: '2026-11-07',
          title: 'Kalahari–Makgadikgadi Flaming Front',
          regionName: 'Southern Africa · Botswana / Kalahari Basin',
          subtitle: '2,009.9 MW MODIS Pixel-Center Peak (-23.72°, 22.25°) · 2026-11-07',
          lat: -23.7190,
          lon: 22.2473,
          sinLat: Math.sin(-23.7190 * DEG2RAD),
          cosLat: Math.cos(-23.7190 * DEG2RAD),
          regionId: 'saf',
          biome: 'kalahari_savanna',
          peakCountDay: '2026-11-07',
          peakFrpDay: '2026-11-07',
          maxFrpMw: 34932.2,
          clusters1km: 289,
        },
        {
          id: 'mozambique_zambezia',
          year: 2026,
          incidentDate: '2026-11-08',
          title: 'Northern Mozambique Niassa Fire Belt',
          regionName: 'Southern Africa · Niassa & Cabo Delgado Corridor',
          subtitle: '497 Geodesic Clusters (1km M2c) · 95.3% Daytime',
          lat: -11.4215,
          lon: 39.1840,
          sinLat: Math.sin(-11.4215 * DEG2RAD),
          cosLat: Math.cos(-11.4215 * DEG2RAD),
          regionId: 'saf',
          biome: 'miombo_woodland',
          peakCountDay: '2026-11-08',
          peakFrpDay: '2026-11-08',
          maxFrpMw: 14280.5,
          clusters1km: 497,
        },
        {
          id: 'waf_sahel_belt',
          year: 2026,
          incidentDate: '2026-11-09',
          title: 'Sub-Saharan Sahel Savanna Corridor',
          regionName: 'West & Central Africa · Sudano-Sahelian Belt',
          subtitle: 'High-Density Diurnal Biomass Burning Front',
          lat: 8.1450,
          lon: 18.2210,
          sinLat: Math.sin(8.1450 * DEG2RAD),
          cosLat: Math.cos(8.1450 * DEG2RAD),
          regionId: 'waf',
          biome: 'sahel_grassland',
          peakCountDay: '2026-11-09',
          peakFrpDay: '2026-11-08',
          maxFrpMw: 42150.0,
          clusters1km: 615,
        },
        {
          id: 'car_bushfires_2025',
          year: 2025,
          incidentDate: '2025-12-18',
          title: 'Central African Savanna Dry-Season Fires',
          regionName: 'Central Africa · Ouadda–Bamingui Belt',
          subtitle: 'NASA VIIRS / GIBS December Dry-Season Belt (2025)',
          lat: 7.4500,
          lon: 21.8500,
          sinLat: Math.sin(7.4500 * DEG2RAD),
          cosLat: Math.cos(7.4500 * DEG2RAD),
          regionId: 'waf',
          biome: 'sahel_grassland',
          peakCountDay: '2025-12-18',
          peakFrpDay: '2025-12-18',
          maxFrpMw: 38400.0,
          clusters1km: 520,
        },
        {
          id: 'pringle_bay_2024',
          year: 2024,
          incidentDate: '2024-01-31',
          title: 'Pringle Bay & Hangklip Wildfire',
          regionName: 'Western Cape · Overstrand Coast, South Africa',
          subtitle: 'Landsat 8 OLI Active Fire Perimeter (~783 ha, Jan 2024)',
          lat: -34.3455,
          lon: 18.8280,
          sinLat: Math.sin(-34.3455 * DEG2RAD),
          cosLat: Math.cos(-34.3455 * DEG2RAD),
          regionId: 'saf',
          biome: 'fynbos_coastal',
          peakCountDay: '2024-01-31',
          peakFrpDay: '2024-01-31',
          maxFrpMw: 6120.0,
          clusters1km: 94,
        },
        {
          id: 'lahaina_2023',
          year: 2023,
          incidentDate: '2023-08-08',
          storyId: 'FIRE-STORY-003',
          title: 'Lahaina Historical Wildfire (Fire Story)',
          regionName: 'Maui, Hawai\'i · Historic Front Street & Lahainaluna',
          subtitle: 'ATF/MFD Confirmed Cause (Pole #25) · ~878 ha · 102 Fatalities',
          lat: 20.8783,
          lon: -156.6825,
          sinLat: Math.sin(20.8783 * DEG2RAD),
          cosLat: Math.cos(20.8783 * DEG2RAD),
          regionId: 'usa',
          biome: 'coastal_grassland',
          peakCountDay: '2023-08-08',
          peakFrpDay: '2023-08-08',
          maxFrpMw: 9450.0,
          clusters1km: 78,
        },
        {
          id: 'chobe_okavango_2022',
          year: 2022,
          incidentDate: '2022-05-23',
          title: 'Chobe–Zambezi Savanna Peak (2022 Benchmark)',
          regionName: 'Southern Africa · Northern Botswana / Zambezi Margin',
          subtitle: 'MODIS Pixel-Center Peak 703.3 MW (-17.96°, 24.33°) · 2022-05-23',
          lat: -17.9591,
          lon: 24.3346,
          sinLat: Math.sin(-17.9591 * DEG2RAD),
          cosLat: Math.cos(-17.9591 * DEG2RAD),
          regionId: 'saf',
          biome: 'miombo_woodland',
          peakCountDay: '2022-05-26',
          peakFrpDay: '2022-05-23',
          maxFrpMw: 19240.0,
          clusters1km: 342,
        },
        {
          id: 'angola_zambia_miombo',
          year: 2022,
          incidentDate: '2022-05-26',
          title: 'Upper Zambezi Miombo Belt (2022)',
          regionName: 'Southern Africa · Angola / Western Zambia',
          subtitle: '2022 Early Dry-Season VIIRS vs MODIS Divergence',
          lat: -14.2150,
          lon: 20.8420,
          sinLat: Math.sin(-14.2150 * DEG2RAD),
          cosLat: Math.cos(-14.2150 * DEG2RAD),
          regionId: 'saf',
          biome: 'miombo_woodland',
          peakCountDay: '2022-05-26',
          peakFrpDay: '2022-05-23',
          maxFrpMw: 22100.0,
          clusters1km: 365,
        },
        {
          id: 'table_mountain_2021',
          year: 2021,
          incidentDate: '2021-04-18',
          storyId: 'FIRE-STORY-001',
          title: 'Table Mountain & UCT Library Fire (Fire Story)',
          regionName: 'Western Cape · Devil\'s Peak & Rondebosch, Cape Town',
          subtitle: 'Probable Arson (SANParks/Enviro Report) · ~600 ha · UCT Special Collections',
          lat: -33.9522,
          lon: 18.4589,
          sinLat: Math.sin(-33.9522 * DEG2RAD),
          cosLat: Math.cos(-33.9522 * DEG2RAD),
          regionId: 'saf',
          biome: 'fynbos_mountain',
          peakCountDay: '2021-04-18',
          peakFrpDay: '2021-04-18',
          maxFrpMw: 4820.0,
          clusters1km: 52,
        },
        {
          id: 'bejaia_algeria_2021',
          year: 2021,
          incidentDate: '2021-08-12',
          title: 'Kabylia / Béjaïa Mediterranean Wildfires',
          regionName: 'North Africa · Tizi Ouzou & Béjaïa, Algeria',
          subtitle: 'Sentinel-2 & MODIS Plume (Aug 2021 Heatwave)',
          lat: 36.6830,
          lon: 4.5540,
          sinLat: Math.sin(36.6830 * DEG2RAD),
          cosLat: Math.cos(36.6830 * DEG2RAD),
          regionId: 'med',
          biome: 'mediterranean_forest',
          peakCountDay: '2021-08-11',
          peakFrpDay: '2021-08-11',
          maxFrpMw: 16800.0,
          clusters1km: 280,
        },
        {
          id: 'kilimanjaro_2020',
          year: 2020,
          incidentDate: '2020-10-15',
          title: 'Mount Kilimanjaro Alpine Heath Fire',
          regionName: 'East Africa · Kilimanjaro National Park, Tanzania',
          subtitle: 'Sentinel-2 IR Fire Front · ~9,550 ha (Oct 2020)',
          lat: -3.1120,
          lon: 37.3920,
          sinLat: Math.sin(-3.1120 * DEG2RAD),
          cosLat: Math.cos(-3.1120 * DEG2RAD),
          regionId: 'eaf',
          biome: 'afroalpine_moorland',
          peakCountDay: '2020-10-15',
          peakFrpDay: '2020-10-15',
          maxFrpMw: 3910.0,
          clusters1km: 48,
        },
        {
          id: 'aus_black_summer_2020',
          year: 2020,
          incidentDate: '2020-01-01',
          title: 'Australia Black Summer (East Gippsland / NSW)',
          regionName: 'Southeastern Australia · Mallacoota & Bateman\'s Bay',
          subtitle: 'Pyrocumulonimbus GIBS Benchmark (Jan 2020)',
          lat: -37.2410,
          lon: 149.4520,
          sinLat: Math.sin(-37.2410 * DEG2RAD),
          cosLat: Math.cos(-37.2410 * DEG2RAD),
          regionId: 'aus_pac',
          biome: 'eucalypt_forest',
          peakCountDay: '2020-01-01',
          peakFrpDay: '2020-01-01',
          maxFrpMw: 62400.0,
          clusters1km: 890,
        },
        {
          id: 'knysna_2017',
          year: 2017,
          incidentDate: '2017-06-07',
          storyId: 'FIRE-STORY-002',
          title: 'Knysna & Garden Route Disaster (Fire Story)',
          regionName: 'Western Cape · Knysna, Sedgefield & Plettenberg Bay',
          subtitle: 'CSIR Holdover Lightning + Berg Winds · ~15,000 ha · 7 Fatalities',
          lat: -34.0351,
          lon: 23.0465,
          sinLat: Math.sin(-34.0351 * DEG2RAD),
          cosLat: Math.cos(-34.0351 * DEG2RAD),
          regionId: 'saf',
          biome: 'fynbos_plantation',
          peakCountDay: '2017-06-07',
          peakFrpDay: '2017-06-07',
          maxFrpMw: 24500.0,
          clusters1km: 215,
        },
        {
          id: 'muizenberg_2015',
          year: 2015,
          incidentDate: '2015-03-02',
          storyId: 'FIRE-STORY-004',
          title: 'Muizenberg & Tokai Peninsula Fire (Fire Story)',
          regionName: 'Western Cape · Boyes Drive, Silvermine & Tokai, Cape Town',
          subtitle: 'SANParks Forensic Review (Boyes Dr) · ~5,500 ha · March 2015',
          lat: -34.0950,
          lon: 18.4580,
          sinLat: Math.sin(-34.0950 * DEG2RAD),
          cosLat: Math.cos(-34.0950 * DEG2RAD),
          regionId: 'saf',
          biome: 'fynbos_mountain',
          peakCountDay: '2015-03-02',
          peakFrpDay: '2015-03-02',
          maxFrpMw: 7850.0,
          clusters1km: 112,
        }
      ];
      this.globeEvents = this.allGlobeEvents.filter(e => e.year === this.activeYear);

      this._bindEvents();
      this._startAnimationLoop();
    }

    _initWebGL() {
      if (!this.webglCanvas) return null;
      const gl = this.webglCanvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        powerPreference: 'high-performance',
      });
      if (!gl) return null;

      const vsSrc = `
        attribute vec2 a_pos;
        varying vec2 v_uv;
        void main() {
          v_uv = a_pos * 0.5 + 0.5;
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }
      `;

      const fsSrc = `
        precision highp float;
        varying vec2 v_uv;
        uniform vec2 u_res;
        uniform vec2 u_center;
        uniform float u_radius;
        uniform float u_zoom;
        uniform float u_sinPhi0;
        uniform float u_cosPhi0;
        uniform float u_rotLon;
        uniform float u_isNight;
        uniform sampler2D u_blueTex;
        uniform sampler2D u_blackTex;
        uniform sampler2D u_detailTex;
        uniform vec4 u_detailMercBox;
        uniform float u_detailBlend;
        uniform float u_hasBlue;
        uniform float u_hasBlack;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        void main() {
          float sx = v_uv.x * u_res.x;
          float sy = (1.0 - v_uv.y) * u_res.y;
          float u = (sx - u_center.x) / u_radius;
          float v = (u_center.y - sy) / u_radius;
          float r2 = u * u + v * v;

          if (r2 > 1.0) {
            float r = sqrt(r2);
            vec3 spaceCol = vec3(0.0);
            // Crisp lightweight GPU starfield
            vec2 cell = floor(vec2(sx, sy) * 0.45);
            float h = hash21(cell);
            if (h > 0.9968) {
              float tw = (h - 0.9968) / 0.0032;
              spaceCol = vec3(0.75 + 0.25 * tw, 0.85 + 0.15 * tw, 1.0) * (0.32 + 0.55 * tw);
            }
            if (r < 1.14) {
              float halo = exp(-(r - 1.0) * 24.0);
              vec3 rimCol = u_isNight > 0.5 ? vec3(0.14, 0.40, 0.92) : vec3(0.32, 0.62, 0.98);
              spaceCol += rimCol * halo * 0.46;
            }
            gl_FragColor = vec4(spaceCol, 1.0);
            return;
          }

          float z = sqrt(max(0.0, 1.0 - r2));
          float sinPhi = clamp(v * u_cosPhi0 + z * u_sinPhi0, -1.0, 1.0);
          float denomZ = z * u_cosPhi0 - v * u_sinPhi0;
          float latRad = asin(sinPhi);
          float dLam = atan(u, denomZ);
          float lonDeg = u_rotLon + dLam * 57.295779513;
          float texU = fract((lonDeg + 180.0) / 360.0);
          float texV = clamp((1.5707963268 - latRad) / 3.1415926536, 0.001, 0.999);

          vec3 texCol;
          if (u_isNight > 0.5 && u_hasBlack > 0.5) {
            texCol = texture2D(u_blackTex, vec2(texU, texV)).rgb;
            // Subtle cobalt night atmosphere lift matching NASA SVS thermal night view
            texCol = mix(texCol, vec3(0.03, 0.12, 0.42), 0.28) * 1.15;
          } else if (u_hasBlue > 0.5) {
            texCol = texture2D(u_blueTex, vec2(texU, texV)).rgb;
          } else {
            texCol = vec3(0.05, 0.14, 0.30);
          }

          // Project streamed high-resolution Web Mercator satellite imagery seamlessly onto curved sphere
          if (u_detailBlend > 0.002 && u_isNight < 0.5) {
            float mercX = fract((lonDeg + 180.0) / 360.0);
            float clLat = clamp(latRad, -1.4844, 1.4844);
            float mercY = 0.5 - log(tan(0.78539816339 + clLat * 0.5)) / 6.28318530718;
            float dx = fract(mercX - u_detailMercBox.x);
            float uvX = dx / max(0.00001, u_detailMercBox.z);
            float uvY = (mercY - u_detailMercBox.y) / max(0.00001, u_detailMercBox.w);
            if (uvX > 0.0 && uvX < 1.0 && uvY > 0.0 && uvY < 1.0) {
              vec4 det = texture2D(u_detailTex, vec2(uvX, uvY));
              float edge = smoothstep(0.0, 0.08, uvX) * smoothstep(1.0, 0.92, uvX)
                         * smoothstep(0.0, 0.08, uvY) * smoothstep(1.0, 0.92, uvY);
              texCol = mix(texCol, det.rgb, det.a * edge * u_detailBlend);
            }
          }

          // Directional solar key light + limb Rayleigh Fresnel glow (lift shadows gracefully at close zoom)
          vec3 sunDir = normalize(vec3(-0.42, 0.36, 0.83));
          vec3 nrm = vec3(u, v, z);
          float ndl = max(0.0, dot(nrm, sunDir));
          float baseShade = u_isNight > 0.5 ? (0.72 + 0.28 * z) : (0.34 + 0.78 * pow(ndl, 0.85));
          float zoomLift = clamp((u_zoom - 1.8) * 0.28, 0.0, 0.86);
          float shade = u_isNight > 0.5 ? baseShade : mix(baseShade, 0.96, zoomLift);
          float fresnel = pow(1.0 - z, 3.0) * (1.0 - zoomLift * 0.75);
          vec3 atmo = u_isNight > 0.5 ? vec3(0.16, 0.44, 0.98) : vec3(0.40, 0.70, 1.0);
          vec3 finalCol = texCol * shade + atmo * fresnel * 0.44;

          gl_FragColor = vec4(finalCol, 1.0);
        }
      `;

      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          gl.deleteShader(sh);
          return null;
        }
        return sh;
      };

      const vs = compile(gl.VERTEX_SHADER, vsSrc);
      const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
      if (!vs || !fs) return null;

      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

      gl.useProgram(prog);
      const aPos = gl.getAttribLocation(prog, 'a_pos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      const createTex = (repeatS = true) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeatS ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([8, 22, 54, 0]));
        return t;
      };

      return {
        gl,
        prog,
        u_res: gl.getUniformLocation(prog, 'u_res'),
        u_center: gl.getUniformLocation(prog, 'u_center'),
        u_radius: gl.getUniformLocation(prog, 'u_radius'),
        u_zoom: gl.getUniformLocation(prog, 'u_zoom'),
        u_sinPhi0: gl.getUniformLocation(prog, 'u_sinPhi0'),
        u_cosPhi0: gl.getUniformLocation(prog, 'u_cosPhi0'),
        u_rotLon: gl.getUniformLocation(prog, 'u_rotLon'),
        u_isNight: gl.getUniformLocation(prog, 'u_isNight'),
        u_blueTex: gl.getUniformLocation(prog, 'u_blueTex'),
        u_blackTex: gl.getUniformLocation(prog, 'u_blackTex'),
        u_detailTex: gl.getUniformLocation(prog, 'u_detailTex'),
        u_detailMercBox: gl.getUniformLocation(prog, 'u_detailMercBox'),
        u_detailBlend: gl.getUniformLocation(prog, 'u_detailBlend'),
        u_hasBlue: gl.getUniformLocation(prog, 'u_hasBlue'),
        u_hasBlack: gl.getUniformLocation(prog, 'u_hasBlack'),
        blueTex: createTex(true),
        blackTex: createTex(true),
        detailTex: createTex(false),
        hasBlue: false,
        hasBlack: false,
        hasDetail: false,
      };
    }

    _loadEarthTextures() {
      const loadOne = (url, key, texUnit) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          this.earthImages[key] = img;
          if (this.glState) {
            const { gl, blueTex, blackTex } = this.glState;
            const targetTex = texUnit === 0 ? blueTex : blackTex;
            gl.activeTexture(gl.TEXTURE0 + texUnit);
            gl.bindTexture(gl.TEXTURE_2D, targetTex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            // Generate mipmaps for smooth anti-aliased orbital viewing (both images are 2048x1024 POT)
            if ((img.width & (img.width - 1)) === 0 && (img.height & (img.height - 1)) === 0) {
              gl.generateMipmap(gl.TEXTURE_2D);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            }
            if (texUnit === 0) this.glState.hasBlue = true;
            else this.glState.hasBlack = true;
          }
        };
        img.src = url;
      };
      loadOne('assets/earth/blue_marble_2048.jpg', 'visible_earth', 0);
      loadOne('assets/earth/black_marble_2048.jpg', 'cobalt_night', 1);
    }

    zoomBy(factor) {
      this.targetZoom = Math.max(0.78, Math.min(360.0, this.targetZoom * factor));
    }

    _lonToTileX(lon, z) {
      return ((lon + 180) / 360) * Math.pow(2, z);
    }

    _latToTileY(lat, z) {
      const cl = Math.max(-85.0511, Math.min(85.0511, lat)) * DEG2RAD;
      const merc = 0.5 - Math.log(Math.tan(Math.PI / 4 + cl * 0.5)) / TWO_PI;
      return merc * Math.pow(2, z);
    }

    _evictTileCacheIfNeeded() {
      if (this._tileCache.size <= 460) return;
      const entries = [...this._tileCache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      const drop = entries.length - 360;
      for (let i = 0; i < drop; i++) {
        this._tileCache.delete(entries[i][0]);
      }
    }

    _queueTileFetch(z, tx, ty) {
      const key = `${z}/${tx}/${ty}`;
      if (this._tileCache.has(key)) {
        this._tileCache.get(key).lastUsed = performance.now();
        return;
      }
      if (this._inFlightTiles >= this._maxInFlightTiles) return;

      this._tileCache.set(key, { status: 'loading', img: null, lastUsed: performance.now() });
      this._inFlightTiles++;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => {
        this._inFlightTiles = Math.max(0, this._inFlightTiles - 1);
        const rec = this._tileCache.get(key);
        if (rec) {
          rec.status = 'ready';
          rec.img = img;
          rec.lastUsed = performance.now();
        }
        this._detailDirty = true;
      };
      img.onerror = () => {
        this._inFlightTiles = Math.max(0, this._inFlightTiles - 1);
        const rec = this._tileCache.get(key);
        if (rec) rec.status = 'error';
      };
      img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
      this._evictTileCacheIfNeeded();
    }

    _updateDetailTiles(baseRadius, viewW, viewH) {
      if (!this.glState || this.earthStyle !== 'visible_earth' || this.zoom < 1.9) return 0.0;

      // Choose Web Mercator zoom so 8x8 tile window always spans beyond the visible viewport with high native density
      const cosLat = Math.max(0.35, Math.cos(this.rotLat * DEG2RAD));
      const worldPx = TWO_PI * baseRadius * cosLat;
      const viewSpanCss = Math.max(viewW || 1280, viewH || 800) * 1.04;
      const gridN = this._detailGridN;
      const idealZ = Math.floor(Math.log2((gridN * worldPx) / viewSpanCss));
      const z = Math.max(3, Math.min(13, idealZ));
      const n = Math.pow(2, z);
      const tilePx = this._detailTilePx;

      const centerFX = this._lonToTileX(this.rotLon, z);
      const centerFY = this._latToTileY(this.rotLat, z);
      const tx0Raw = Math.floor(centerFX - gridN * 0.5 + 0.5);
      const ty0Clamped = Math.max(0, Math.min(n - gridN, Math.floor(centerFY - gridN * 0.5 + 0.5)));

      const winKey = `${z}:${tx0Raw}:${ty0Clamped}`;
      if (winKey !== this._detailWindowKey) {
        this._detailWindowKey = winKey;
        this._detailDirty = true;
      }

      if (this._detailDirty) {
        this._detailDirty = false;
        const actx = this._detailAtlasCtx;
        actx.clearRect(0, 0, this._detailAtlasCanvas.width, this._detailAtlasCanvas.height);

        const missing = [];
        let paintedAny = false;

        for (let gy = 0; gy < gridN; gy++) {
          const ty = ty0Clamped + gy;
          if (ty < 0 || ty >= n) continue;
          for (let gx = 0; gx < gridN; gx++) {
            const tx = ((tx0Raw + gx) % n + n) % n;
            const key = `${z}/${tx}/${ty}`;
            const rec = this._tileCache.get(key);
            if (rec && rec.status === 'ready' && rec.img) {
              rec.lastUsed = performance.now();
              actx.drawImage(rec.img, gx * tilePx, gy * tilePx, tilePx, tilePx);
              paintedAny = true;
            } else {
              // Fall back seamlessly to any already-cached parent tile while crisp tile loads
              for (let pz = z - 1; pz >= Math.max(2, z - 4); pz--) {
                const scale = Math.pow(2, z - pz);
                const ptx = Math.floor(tx / scale);
                const pty = Math.floor(ty / scale);
                const prec = this._tileCache.get(`${pz}/${ptx}/${pty}`);
                if (prec && prec.status === 'ready' && prec.img) {
                  const sub = tilePx / scale;
                  const sx = (tx % scale) * sub;
                  const sy = (ty % scale) * sub;
                  actx.drawImage(prec.img, sx, sy, sub, sub, gx * tilePx, gy * tilePx, tilePx, tilePx);
                  paintedAny = true;
                  break;
                }
              }
              if (!rec) {
                const dist2 = Math.pow(gx - gridN * 0.5 + 0.5, 2) + Math.pow(gy - gridN * 0.5 + 0.5, 2);
                missing.push({ z, tx, ty, dist2 });
              }
            }
          }
        }

        // Fetch closest center tiles first + also fetch one parent z-1 ring to eliminate seams on fast pan
        missing.sort((a, b) => a.dist2 - b.dist2);
        for (let i = 0; i < missing.length; i++) {
          this._queueTileFetch(missing[i].z, missing[i].tx, missing[i].ty);
        }

        const x0Norm = (((tx0Raw % n) + n) % n) / n;
        const y0Norm = ty0Clamped / n;
        const spanNorm = gridN / n;
        this._detailMercBox = [x0Norm, y0Norm, spanNorm, spanNorm];

        if (paintedAny) {
          const { gl, detailTex } = this.glState;
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, detailTex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._detailAtlasCanvas);
          this.glState.hasDetail = true;
        }
      }

      if (!this.glState.hasDetail) return 0.0;
      return Math.min(1.0, Math.max(0.0, (this.zoom - 1.9) / 1.35));
    }

    _initSatellites() {
      const specs = [
        { id: 'NOAA-20', label: 'NOAA-20 (VIIRS J1)', shortLabel: 'NOAA-20', instrument: 'VIIRS 375m · 13:46 LST', inc: 98.7, raan: 28, altRatio: 1.13, speed: 0.35, phase0: 0.45, color: '#F59E0B', ringColor: 'rgba(245, 158, 11, 0.48)', trailColor: '#FBBF24', isPrimary: true },
        { id: 'NOAA-21', label: 'NOAA-21 (VIIRS J2)', shortLabel: 'NOAA-21', instrument: 'VIIRS 375m · 13:31 LST', inc: 98.7, raan: 78, altRatio: 1.16, speed: 0.34, phase0: 1.95, color: '#A855F7', ringColor: 'rgba(168, 85, 247, 0.46)', trailColor: '#C084FC', isPrimary: true },
        { id: 'Aqua', label: 'Aqua (MODIS)', shortLabel: 'Aqua', instrument: 'MODIS 1km · 15:59 LST', inc: 98.2, raan: -24, altRatio: 1.105, speed: 0.37, phase0: 4.75, color: '#38BDF8', ringColor: 'rgba(56, 189, 248, 0.48)', trailColor: '#7DD3FC', isPrimary: true },
        { id: 'Terra', label: 'Terra (MODIS)', shortLabel: 'Terra', instrument: 'MODIS 1km · 08:29 LST', inc: 98.2, raan: -68, altRatio: 1.09, speed: 0.36, phase0: 2.65, color: '#2DD4BF', ringColor: 'rgba(45, 212, 191, 0.46)', trailColor: '#5EEAD4', isPrimary: true },
        { id: 'Suomi-NPP', label: 'Suomi NPP', shortLabel: 'Suomi NPP', instrument: 'VIIRS · 2026 Feed Empty / 2022 Active', inc: 98.7, raan: 125, altRatio: 1.142, speed: 0.33, phase0: 5.2, color: '#94A3B8', ringColor: 'rgba(148, 163, 184, 0.32)', trailColor: '#CBD5E1', isPrimary: true },
        { id: 'Landsat-9', label: 'Landsat 9', shortLabel: 'Landsat 9', instrument: 'OLI-2 / TIRS-2 · Context', inc: 98.2, raan: 5, altRatio: 1.075, speed: 0.31, phase0: 1.35, color: '#86EFAC', ringColor: 'rgba(134, 239, 172, 0.26)', trailColor: '#86EFAC', isPrimary: false },
        { id: 'Sentinel-6', label: 'Sentinel-6 Michael Freilich', shortLabel: 'Sentinel-6', instrument: 'Radar Altimeter · Context', inc: 66.0, raan: -42, altRatio: 1.18, speed: 0.29, phase0: 4.3, color: '#FCA5A5', ringColor: 'rgba(252, 165, 165, 0.26)', trailColor: '#FCA5A5', isPrimary: false },
      ];

      return specs.map(sat => {
        const N = this.orbitSteps;
        const ringSinLat = new Float32Array(N + 1);
        const ringCosLat = new Float32Array(N + 1);
        const ringLon = new Float32Array(N + 1);
        const incRad = sat.inc * DEG2RAD;
        const sinInc = Math.sin(incRad);
        const cosInc = Math.cos(incRad);

        for (let i = 0; i <= N; i++) {
          const u = (i / N) * TWO_PI;
          const sinLat = Math.max(-1, Math.min(1, sinInc * Math.sin(u)));
          const latRad = Math.asin(sinLat);
          ringSinLat[i] = sinLat;
          ringCosLat[i] = Math.cos(latRad);
          let lon = sat.raan + Math.atan2(cosInc * Math.sin(u), Math.cos(u)) / DEG2RAD;
          if (lon > 180) lon -= 360;
          if (lon < -180) lon += 360;
          ringLon[i] = lon;
        }
        return { ...sat, sinInc, cosInc, ringSinLat, ringCosLat, ringLon };
      });
    }

    _buildOffscreenSprites() {
      const makeRadialSprite = (size, stops) => {
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const gctx = c.getContext('2d');
        const r = size / 2;
        const grad = gctx.createRadialGradient(r, r, r * 0.05, r, r, r);
        stops.forEach(([offset, color]) => grad.addColorStop(offset, color));
        gctx.fillStyle = grad;
        gctx.beginPath();
        gctx.arc(r, r, r, 0, TWO_PI);
        gctx.fill();
        return c;
      };

      return {
        fireHot: makeRadialSprite(32, [
          [0.0, 'rgba(255, 255, 224, 0.98)'],
          [0.3, 'rgba(255, 195, 40, 0.88)'],
          [0.65, 'rgba(249, 115, 22, 0.45)'],
          [1.0, 'rgba(220, 38, 38, 0.0)']
        ]),
        fireWarm: makeRadialSprite(28, [
          [0.0, 'rgba(254, 240, 138, 0.92)'],
          [0.38, 'rgba(234, 88, 12, 0.65)'],
          [1.0, 'rgba(185, 28, 28, 0.0)']
        ]),
        cityLight: makeRadialSprite(24, [
          [0.0, 'rgba(255, 255, 255, 0.92)'],
          [0.4, 'rgba(147, 197, 253, 0.38)'],
          [1.0, 'rgba(37, 99, 235, 0.0)']
        ]),
      };
    }

    _compileNightCities() {
      const raw = [
        [48.8, 2.3, 1.0], [51.5, -0.1, 1.0], [30.0, 31.2, 1.2], [6.5, 3.4, 0.95],
        [-26.2, 28.0, 1.1], [-33.9, 18.4, 0.95], [19.1, 72.8, 1.0], [31.2, 121.5, 1.1]
      ];
      return raw.map(([lat, lon, mag]) => ({
        lon,
        sinLat: Math.sin(lat * DEG2RAD),
        cosLat: Math.cos(lat * DEG2RAD),
        mag,
      }));
    }

    setGeoJSON(geojson) {
      if (!geojson || !Array.isArray(geojson.features)) return;
      this.compiledPolygons = [];
      for (let fIdx = 0; fIdx < geojson.features.length; fIdx++) {
        const geom = geojson.features[fIdx].geometry;
        if (!geom) continue;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : (geom.type === 'MultiPolygon' ? geom.coordinates : []);
        for (let pIdx = 0; pIdx < polys.length; pIdx++) {
          const ring = polys[pIdx][0];
          if (!ring || ring.length < 4) continue;
          const step = ring.length > 90 ? 2 : 1;
          const pts = [];
          let sumLat = 0, sumLon = 0;
          for (let k = 0; k < ring.length; k += step) {
            const lon = ring[k][0];
            const lat = ring[k][1];
            pts.push([lat, lon]);
            sumLat += lat;
            sumLon += lon;
          }
          if (pts.length < 3) continue;
          const n = pts.length;
          const lats = new Float32Array(n);
          const lons = new Float32Array(n);
          const sinLats = new Float32Array(n);
          const cosLats = new Float32Array(n);
          for (let k = 0; k < n; k++) {
            lats[k] = pts[k][0];
            lons[k] = pts[k][1];
            sinLats[k] = Math.sin(pts[k][0] * DEG2RAD);
            cosLats[k] = Math.cos(pts[k][0] * DEG2RAD);
          }
          const cLat = sumLat / n;
          const cLon = sumLon / n;
          this.compiledPolygons.push({
            len: n,
            lats,
            lons,
            sinLats,
            cosLats,
            cLat,
            cLon,
            sinCLat: Math.sin(cLat * DEG2RAD),
            cosCLat: Math.cos(cLat * DEG2RAD),
            biomeFill: cLat >= 13 && cLat <= 33 && cLon >= -18 && cLon <= 58 ? '#9E764E' : '#35503A',
          });
        }
      }
    }

    setObservationPoints(points, metricMode, activePlatforms) {
      if (metricMode) this.metricMode = metricMode;
      if (activePlatforms) this.activePlatforms = new Set(activePlatforms);

      const rawPts = points || [];
      const isFrp = this.metricMode === 'frp' || this.metricMode === 'nadir_frp';
      const compiled = [];

      for (let i = 0; i < rawPts.length; i++) {
        const d = rawPts[i];
        if (!this.activePlatforms.has(d[0])) continue;
        const val = isFrp ? (this.metricMode === 'nadir_frp' ? d[5] : d[4]) : d[3];
        if (val <= 0) continue;
        const lat = d[1];
        const lon = d[2];
        compiled.push({
          raw: d,
          plat: d[0],
          lat,
          lon,
          sinLat: Math.sin(lat * DEG2RAD),
          cosLat: Math.cos(lat * DEG2RAD),
          val,
          normSize: Math.min(1.0, Math.log10(val + 1) / (isFrp ? 4.2 : 3.2)),
        });
      }

      compiled.sort((a, b) => b.val - a.val);
      this.allDayPoints = compiled;
    }

    setActiveYear(year) {
      this.activeYear = Number(year) || 2026;
      const filtered = this.allGlobeEvents.filter(e => e.year === this.activeYear);
      this.globeEvents = filtered;
      return filtered;
    }

    triggerTimeTravelRotation(daysDelta) {
      const mag = Math.min(4, Math.max(1, Math.abs(daysDelta || 1)));
      if (daysDelta < 0) {
        this.spinDirection = -1;
        // Smooth velocity target for backward historical rotation (+eastward rewind feel)
        this.spinBoostDegPerSec = 14.0 + mag * 4.5;
      } else if (daysDelta > 0) {
        this.spinDirection = 1;
        this.spinBoostDegPerSec = -(10.0 + mag * 3.5);
      }
      this.spinBoostUntil = performance.now() + 1450;
      this.pauseSpinUntil = 0;
      this.autoSpin = true;
    }

    setProjectionMode(mode) {
      this.projectionMode = mode === '2D' ? '2D' : '3D';
    }

    setEarthStyle(style) {
      this.earthStyle = style === 'cobalt_night' ? 'cobalt_night' : 'visible_earth';
    }

    flyTo(lat, lon, zoom = 2.15, fireZoneMeta = null) {
      this.targetLat = Math.max(-75, Math.min(75, lat));
      this.targetLon = lon;
      this.targetZoom = Math.max(0.78, Math.min(360.0, zoom));
      this.velLon = 0;
      this.velLat = 0;
      this.spinBoostDegPerSec = 0;
      this.spinBoostUntil = 0;
      if (fireZoneMeta) {
        this.selectedFireZone = fireZoneMeta;
      }
      this.pauseSpinUntil = performance.now() + (zoom >= 1.7 ? 9000 : 2200);
    }

    projectFast3D(sinPhi, cosPhi, lonDeg, sinPhi0, cosPhi0, cx, cy, radius) {
      const lam = (lonDeg - this.rotLon) * DEG2RAD;
      const cosLam = Math.cos(lam);
      const cosC = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosLam;
      const x = cx + radius * (cosPhi * Math.sin(lam));
      const y = cy - radius * (cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosLam);
      return { x, y, z: cosC, visible: cosC >= 0 };
    }

    project2D(latDeg, lonDeg, w, h) {
      const padX = 56, padY = 74;
      const plotW = w - padX * 2;
      const plotH = h - padY * 2;
      const x = padX + ((lonDeg + 180) / 360) * plotW;
      const y = padY + ((90 - latDeg) / 180) * plotH;
      return { x, y, z: 1, visible: true };
    }

    _bindEvents() {
      this.canvas.addEventListener('mousedown', (e) => {
        this.isDragging = true;
        this.dragMoved = false;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.velLon = 0;
        this.velLat = 0;
        this.spinBoostDegPerSec = 0;
        this.spinBoostUntil = 0;
      });

      window.addEventListener('mousemove', (e) => {
        if (this.isDragging && this.projectionMode === '3D') {
          const dx = e.clientX - this.dragStartX;
          const dy = e.clientY - this.dragStartY;
          if (Math.hypot(dx, dy) > 2) this.dragMoved = true;
          this.dragStartX = e.clientX;
          this.dragStartY = e.clientY;
          const sens = 0.24 / Math.pow(Math.max(0.75, this.zoom), 0.92);
          const dLon = -dx * sens;
          const dLat = dy * sens;
          this.targetLon += dLon;
          this.targetLat = Math.max(-75, Math.min(75, this.targetLat + dLat));
          this.rotLon = this.targetLon;
          this.rotLat = this.targetLat;
          this.velLon = dLon * 0.8;
          this.velLat = dLat * 0.8;
          this.lastMouseMoveTime = performance.now();
        } else {
          this._handleHover(e);
        }
      });

      window.addEventListener('mouseup', (e) => {
        if (this.isDragging) {
          if (!this.dragMoved) {
            this._handleClick(e);
          } else if (performance.now() - this.lastMouseMoveTime > 90) {
            this.velLon = 0;
            this.velLat = 0;
          }
          this.pauseSpinUntil = performance.now() + 900;
        }
        this.isDragging = false;
      });

      this.canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.22 : 0.82;
        this.zoomBy(factor);
      }, { passive: false });

      this.canvas.addEventListener('mouseleave', () => {
        if (this.tooltip) this.tooltip.style.display = 'none';
      });
    }

    _findNearestFireZone(lat, lon) {
      let best = this.globeEvents[0];
      let bestDist = Infinity;
      for (const ev of this.globeEvents) {
        const d = Math.hypot(ev.lat - lat, ev.lon - lon);
        if (d < bestDist) {
          bestDist = d;
          best = ev;
        }
      }
      return best;
    }

    _triggerNearestFireZonePopup() {
      const nearest = this._findNearestFireZone(this.targetLat, this.targetLon);
      this.selectedFireZone = nearest;
      if (typeof this.onZoomThresholdReached === 'function') {
        this.onZoomThresholdReached(nearest);
      }
    }

    _handleClick(e) {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      for (const ev of this.renderedEventPins) {
        if (Math.hypot(ev.x - mx, ev.y - my) < 18) {
          this.flyTo(ev.raw.lat, ev.raw.lon, 2.25, ev.raw);
          if (typeof this.onSelectEvent === 'function') this.onSelectEvent(ev.raw);
          return;
        }
      }

      for (const sat of this.renderedSatelliteNodes) {
        if (Math.hypot(sat.x - mx, sat.y - my) < 18) {
          if (typeof this.onSelectSatellite === 'function') this.onSelectSatellite(sat.raw);
          return;
        }
      }

      let bestPt = null;
      let bestDist = 10;
      for (let i = 0; i < this.renderedScreenPoints.length; i++) {
        const pt = this.renderedScreenPoints[i];
        const d = Math.hypot(pt.x - mx, pt.y - my);
        if (d < bestDist) {
          bestDist = d;
          bestPt = pt;
        }
      }
      if (bestPt) {
        const raw = bestPt.raw;
        const nearestZone = this._findNearestFireZone(raw[1], raw[2]);
        const isNearKnownZone = nearestZone && Math.hypot(nearestZone.lat - raw[1], nearestZone.lon - raw[2]) <= 2.2;
        const pLabel = raw[0] === 'modis' ? 'MODIS (~1 km pixel center)' : 'VIIRS (~375 m pixel center)';
        const frpVal = Math.round(Number(raw[4] || 0));
        const customZone = isNearKnownZone ? {
          ...nearestZone,
          lat: raw[1],
          lon: raw[2],
          sinLat: Math.sin(raw[1] * DEG2RAD),
          cosLat: Math.cos(raw[1] * DEG2RAD),
          clickedCell: raw,
        } : {
          id: 'detection_cell',
          year: this.activeYear,
          title: 'FIRMS Active Thermal Detection',
          regionName: `${pLabel} · Specific Hotspot`,
          subtitle: `${raw[3] || 1} detection(s) · ${frpVal.toLocaleString()} MW FRP`,
          lat: raw[1],
          lon: raw[2],
          sinLat: Math.sin(raw[1] * DEG2RAD),
          cosLat: Math.cos(raw[1] * DEG2RAD),
          clusters1km: raw[3] || 1,
          maxFrpMw: raw[4] || 0,
          clickedCell: raw,
        };
        this.flyTo(raw[1], raw[2], 2.25, customZone);
        if (typeof this.onSelectFireCluster === 'function') {
          this.onSelectFireCluster(customZone);
        }
      }
    }

    _handleHover(e) {
      if (!this.tooltip || !this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) {
        this.tooltip.style.display = 'none';
        return;
      }

      for (const ev of this.renderedEventPins) {
        if (Math.hypot(ev.x - mx, ev.y - my) < 16) {
          this.canvas.style.cursor = 'pointer';
          this.tooltip.innerHTML = `
            <div style="font-weight:700;color:#F87171;font-size:10.5px;text-transform:uppercase">🔥 CLICK TO ZOOM &amp; VIEW SATELLITE IMAGERY</div>
            <div style="font-weight:700;color:#F8FAFC;font-size:13px;margin:2px 0">${ev.raw.title}</div>
            <div style="font-size:11.5px;color:#CBD5E1">${ev.raw.subtitle}</div>
          `;
          this.tooltip.style.display = 'block';
          this.tooltip.style.left = Math.min(rect.width - 270, mx + 16) + 'px';
          this.tooltip.style.top = Math.max(16, my - 20) + 'px';
          return;
        }
      }

      for (const sat of this.renderedSatelliteNodes) {
        if (Math.hypot(sat.x - mx, sat.y - my) < 16) {
          this.canvas.style.cursor = 'pointer';
          this.tooltip.innerHTML = `
            <div style="font-weight:700;color:${sat.raw.color};font-size:12.5px">${sat.raw.label}</div>
            <div class="mono" style="font-size:11px;color:#CBD5E1;margin-top:2px">
              ${sat.raw.instrument}<br>
              Sub-Satellite: <b>(${sat.lat.toFixed(1)}°, ${sat.lon.toFixed(1)}°)</b>
            </div>
          `;
          this.tooltip.style.display = 'block';
          this.tooltip.style.left = Math.min(rect.width - 260, mx + 16) + 'px';
          this.tooltip.style.top = Math.max(16, my - 20) + 'px';
          return;
        }
      }

      let best = null;
      let bestDist = 13;
      for (let i = 0; i < this.renderedScreenPoints.length; i++) {
        const pt = this.renderedScreenPoints[i];
        const d = Math.hypot(pt.x - mx, pt.y - my);
        if (d < bestDist) {
          bestDist = d;
          best = pt;
        }
      }

      if (best) {
        this.canvas.style.cursor = 'pointer';
        const d = best.raw;
        this.tooltip.innerHTML = `
          <div style="font-weight:700;color:#38BDF8;margin-bottom:2px">${d[0]} · (${d[1].toFixed(2)}°, ${d[2].toFixed(2)}°)</div>
          <div class="mono" style="font-size:11px;line-height:1.4;color:#E2E8F0">
            Detections (Date): <b>${d[3].toLocaleString()}</b><br>
            Observed FRP: <b style="color:#FBBF24">${d[4].toLocaleString()} MW</b><br>
            <span style="color:#34D399">Click to zoom &amp; view NASA fire imagery ›</span>
          </div>
        `;
        this.tooltip.style.display = 'block';
        this.tooltip.style.left = Math.min(rect.width - 250, mx + 14) + 'px';
        this.tooltip.style.top = Math.max(14, my - 20) + 'px';
      } else {
        this.canvas.style.cursor = 'grab';
        this.tooltip.style.display = 'none';
      }
    }

    _startAnimationLoop() {
      const step = (now) => {
        const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameTime) * 0.001));
        this.lastFrameTime = now;

        if (!this.isDragging && this.projectionMode === '3D') {
          if (Math.abs(this.velLon) > 0.002 || Math.abs(this.velLat) > 0.002) {
            this.targetLon += this.velLon;
            this.targetLat = Math.max(-75, Math.min(75, this.targetLat + this.velLat));
            const decay = Math.pow(0.90, dt * 60);
            this.velLon *= decay;
            this.velLat *= decay;
          }

          // Smooth velocity-interpolated continuous Earth spin (pauses automatically when zoomed in to explore detail)
          const boostActive = now < this.spinBoostUntil ? this.spinBoostDegPerSec : 0;
          const desiredSpin = (this.autoSpin && now >= this.pauseSpinUntil && (this.zoom < 1.65 || boostActive !== 0))
            ? (-this.spinDirection * this.spinDegPerSec + boostActive)
            : 0;
          const velEase = 1 - Math.exp(-3.6 * dt);
          this.currentSpinVel += (desiredSpin - this.currentSpinVel) * velEase;
          if (Math.abs(this.currentSpinVel) > 0.01) {
            this.targetLon += this.currentSpinVel * dt;
          }
        }

        const ease = 1 - Math.exp(-6.5 * dt);
        this.rotLon += (this.targetLon - this.rotLon) * ease;
        this.rotLat += (this.targetLat - this.rotLat) * ease;
        this.zoom += (this.targetZoom - this.zoom) * ease;

        this.render(now);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    _ensureSphereFallbackCache() {
      if (this._sphereCacheStyle === this.earthStyle) return;
      this._sphereCacheStyle = this.earthStyle;
      const size = 512;
      const rInt = 220;
      const c = size / 2;
      this._sphereCache.width = size;
      this._sphereCache.height = size;
      const sctx = this._sphereCache.getContext('2d');
      sctx.clearRect(0, 0, size, size);

      const globeGrad = sctx.createRadialGradient(c - 50, c - 55, 8, c, c, rInt);
      if (this.earthStyle === 'cobalt_night') {
        globeGrad.addColorStop(0, '#072470');
        globeGrad.addColorStop(0.7, '#021036');
        globeGrad.addColorStop(1, '#000412');
      } else {
        globeGrad.addColorStop(0, '#193E72');
        globeGrad.addColorStop(0.65, '#0B2246');
        globeGrad.addColorStop(1, '#020712');
      }
      sctx.fillStyle = globeGrad;
      sctx.beginPath();
      sctx.arc(c, c, rInt, 0, TWO_PI);
      sctx.fill();
    }

    _renderWebGLEarth(w, h, cx, cy, baseRadius, sinPhi0, cosPhi0) {
      if (!this.glState || !this.webglCanvas) return false;
      const st = this.glState;
      const gl = st.gl;

      // Render WebGL sphere at Retina/HiDPI pixel resolution (capped at 2.0x) for razor-sharp close-ups
      const glDpr = Math.min(2.0, global.devicePixelRatio || 1);
      const gw = Math.max(1, Math.floor(w * glDpr));
      const gh = Math.max(1, Math.floor(h * glDpr));
      if (this.webglCanvas.width !== gw || this.webglCanvas.height !== gh) {
        this.webglCanvas.width = gw;
        this.webglCanvas.height = gh;
        gl.viewport(0, 0, gw, gh);
      }

      const detailBlend = this._updateDetailTiles(baseRadius, w, h);

      gl.useProgram(st.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, st.blueTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, st.blackTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, st.detailTex);

      gl.uniform2f(st.u_res, gw, gh);
      gl.uniform2f(st.u_center, cx * glDpr, cy * glDpr);
      gl.uniform1f(st.u_radius, baseRadius * glDpr);
      gl.uniform1f(st.u_sinPhi0, sinPhi0);
      gl.uniform1f(st.u_cosPhi0, cosPhi0);
      gl.uniform1f(st.u_rotLon, this.rotLon);
      gl.uniform1f(st.u_isNight, this.earthStyle === 'cobalt_night' ? 1.0 : 0.0);
      gl.uniform1f(st.u_zoom, this.zoom);
      gl.uniform1i(st.u_blueTex, 0);
      gl.uniform1i(st.u_blackTex, 1);
      gl.uniform1i(st.u_detailTex, 2);
      gl.uniform1f(st.u_hasBlue, st.hasBlue ? 1.0 : 0.0);
      gl.uniform1f(st.u_hasBlack, st.hasBlack ? 1.0 : 0.0);
      gl.uniform4f(
        st.u_detailMercBox,
        this._detailMercBox[0],
        this._detailMercBox[1],
        this._detailMercBox[2],
        this._detailMercBox[3]
      );
      gl.uniform1f(st.u_detailBlend, detailBlend);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return st.hasBlue || st.hasBlack;
    }

    render(now = performance.now()) {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // Cap overlay DPR at 1.0 for instantaneous < 0.5ms 2D compositing
      const dpr = 1.0;
      const targetW = Math.floor(rect.width * dpr);
      const targetH = Math.floor(rect.height * dpr);
      if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
        this.canvas.width = targetW;
        this.canvas.height = targetH;
      }

      const ctx = this.ctx;
      const w = rect.width;
      const h = rect.height;
      const elapsedSec = (now - this.startTime) * 0.001;

      if (this.projectionMode === '2D') {
        if (this.webglCanvas) this.webglCanvas.style.display = 'none';
        this._render2DMode(ctx, w, h);
        return;
      }

      if (this.webglCanvas) this.webglCanvas.style.display = 'block';

      const cx = w * 0.5;
      const cy = h * 0.49;
      const baseRadius = Math.min(w, h) * 0.35 * this.zoom;
      const phi0 = this.rotLat * DEG2RAD;
      const sinPhi0 = Math.sin(phi0);
      const cosPhi0 = Math.cos(phi0);

      // 1. Draw GPU-Accelerated NASA Blue/Black Marble 3D Earth in < 0.25ms
      const webglActive = this._renderWebGLEarth(w, h, cx, cy, baseRadius, sinPhi0, cosPhi0);

      ctx.clearRect(0, 0, w, h);

      // Fallback only if WebGL is disabled in browser
      if (!webglActive) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);
        this._ensureSphereFallbackCache();
        const drawR = baseRadius * (256 / 220);
        ctx.drawImage(this._sphereCache, cx - drawR, cy - drawR, drawR * 2, drawR * 2);
      }

      this.renderedSatelliteNodes = [];
      this.renderedEventPins = [];

      // 2. Back-Hemisphere of 3D Satellite Orbits
      if (this.showOrbits && this.earthStyle === 'visible_earth') {
        this._render3DOrbitsPassFast(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0, elapsedSec, true);
      }

      // 3. Fire Clusters & Reticle Clipped to Sphere (skip full-arc tessellation when globe fills viewport)
      ctx.save();
      if (baseRadius < Math.max(w, h) * 1.45) {
        ctx.beginPath();
        ctx.arc(cx, cy, baseRadius, 0, TWO_PI);
        ctx.clip();
      }

      if (this.earthStyle === 'cobalt_night' && !webglActive) {
        this._renderNightCityLightsFast(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0);
      }

      this._renderFirePointsLOD3D(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0);

      if (this.selectedFireZone && this.zoom >= 1.55) {
        this._renderZoomedSwathReticle(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0, elapsedSec);
      }

      ctx.restore();

      // 4. Front-Hemisphere of 3D Satellite Orbits & Labels
      if (this.showOrbits) {
        this._render3DOrbitsPassFast(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0, elapsedSec, false);
      }

      // 5. Coral-Red Fire Recon Event Pins on the Globe
      if (this.showEvents) {
        this._renderGlobeEventsFast(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0, elapsedSec);
      }
    }

    _renderNightCityLightsFast(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0) {
      const sprite = this.sprites.cityLight;
      const scale = Math.sqrt(this.zoom);
      for (let i = 0; i < this.nightCities.length; i++) {
        const c = this.nightCities[i];
        const p = this.projectFast3D(c.sinLat, c.cosLat, c.lon, sinPhi0, cosPhi0, cx, cy, baseRadius);
        if (!p.visible) continue;
        const r = (4.0 + c.mag * 4.5) * scale;
        ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
      }
    }

    _renderFirePointsLOD3D(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0) {
      this.renderedScreenPoints = [];
      const zoomScale = Math.sqrt(Math.max(0.85, this.zoom * 0.85));
      const hotSprite = this.sprites.fireHot;
      const warmSprite = this.sprites.fireWarm;

      const maxVisiblePoints = this.zoom < 1.45 ? 160 : (this.zoom < 2.0 ? 280 : 420);
      let drawnCount = 0;

      for (let i = 0; i < this.allDayPoints.length; i++) {
        if (drawnCount >= maxVisiblePoints) break;
        const pt = this.allDayPoints[i];
        const proj = this.projectFast3D(pt.sinLat, pt.cosLat, pt.lon, sinPhi0, cosPhi0, cx, cy, baseRadius);
        if (!proj.visible || proj.z < 0.08) continue;

        if (this.zoom > 1.5) {
          if (proj.x < -30 || proj.x > cx * 2 + 30 || proj.y < -30 || proj.y > cy * 2 + 30) continue;
        }

        const rOuter = (2.6 + pt.normSize * 5.0) * zoomScale;
        const sprite = pt.normSize > 0.56 ? hotSprite : warmSprite;

        ctx.globalAlpha = Math.min(0.92, (0.48 + 0.44 * pt.normSize) * Math.min(1.0, proj.z * 1.8));
        ctx.drawImage(sprite, proj.x - rOuter, proj.y - rOuter, rOuter * 2, rOuter * 2);

        this.renderedScreenPoints.push({ x: proj.x, y: proj.y, raw: pt.raw });
        drawnCount++;
      }
      ctx.globalAlpha = 1;
    }

    _renderZoomedSwathReticle(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0, elapsedSec) {
      const zf = this.selectedFireZone;
      const p = this.projectFast3D(zf.sinLat, zf.cosLat, zf.lon, sinPhi0, cosPhi0, cx, cy, baseRadius);
      if (!p.visible) return;

      const boxR = Math.min(84, 26 * Math.sqrt(this.zoom));
      ctx.save();
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(p.x - boxR, p.y - boxR, boxR * 2, boxR * 2);
      ctx.setLineDash([]);

      const scanY = p.y - boxR + ((elapsedSec * 28) % (boxR * 2));
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p.x - boxR, scanY);
      ctx.lineTo(p.x + boxR, scanY);
      ctx.stroke();

      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#38BDF8';
      ctx.fillText('VIIRS 375m / MODIS SWATH TARGET', p.x - boxR, p.y - boxR - 6);
      ctx.restore();
    }

    _render3DOrbitsPassFast(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0, elapsedSec, isBackPass) {
      const N = this.orbitSteps;
      for (let sIdx = 0; sIdx < this.satellites.length; sIdx++) {
        const sat = this.satellites[sIdx];
        const isSelectedFirm = this.activePlatforms.has(sat.id);
        if (this.earthStyle === 'cobalt_night' && !isSelectedFirm) continue;

        const r = baseRadius * sat.altRatio;
        ctx.strokeStyle = sat.ringColor;
        ctx.lineWidth = isSelectedFirm ? 1.25 : 0.85;
        ctx.globalAlpha = isBackPass ? 0.28 : (isSelectedFirm ? 0.78 : 0.42);

        ctx.beginPath();
        let penDown = false;
        for (let i = 0; i <= N; i++) {
          const sinPhi = sat.ringSinLat[i];
          const cosPhi = sat.ringCosLat[i];
          const lam = (sat.ringLon[i] - this.rotLon) * DEG2RAD;
          const cosLam = Math.cos(lam);
          const cosC = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosLam;
          const x = cx + r * (cosPhi * Math.sin(lam));
          const y = cy - r * (cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosLam);
          const occluded = cosC < 0 && Math.hypot(x - cx, y - cy) < baseRadius * 0.995;

          if (isBackPass === occluded) {
            if (!penDown) { ctx.moveTo(x, y); penDown = true; }
            else ctx.lineTo(x, y);
          } else {
            penDown = false;
          }
        }
        ctx.stroke();

        if (!isBackPass) {
          const uNow = ((sat.phase0 + this.spinDirection * elapsedSec * sat.speed) % TWO_PI + TWO_PI) % TWO_PI;
          const sinLat = Math.max(-1, Math.min(1, sat.sinInc * Math.sin(uNow)));
          const latRad = Math.asin(sinLat);
          const cosLat = Math.cos(latRad);
          let lon = sat.raan + Math.atan2(sat.cosInc * Math.sin(uNow), Math.cos(uNow)) / DEG2RAD;
          if (lon > 180) lon -= 360;
          if (lon < -180) lon += 360;

          const lam = (lon - this.rotLon) * DEG2RAD;
          const cosLam = Math.cos(lam);
          const cosC = sinPhi0 * sinLat + cosPhi0 * cosLat * cosLam;
          const sx = cx + r * (cosLat * Math.sin(lam));
          const sy = cy - r * (cosPhi0 * sinLat - sinPhi0 * cosLat * cosLam);
          const occluded = cosC < 0 && Math.hypot(sx - cx, sy - cy) < baseRadius * 0.995;

          if (!occluded) {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = isSelectedFirm ? sat.color : 'rgba(226, 232, 240, 0.80)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(sx, sy, 3.8, 0, TWO_PI);
            ctx.stroke();

            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(sx, sy, 1.6, 0, TWO_PI);
            ctx.fill();

            ctx.font = isSelectedFirm ? '500 12px "Space Grotesk", "Inter", sans-serif' : '400 11px "Inter", sans-serif';
            ctx.fillStyle = '#000000';
            ctx.fillText(sat.shortLabel, sx + 9, sy + 5);
            ctx.fillStyle = isSelectedFirm ? '#FFFFFF' : '#CBD5E1';
            ctx.fillText(sat.shortLabel, sx + 8, sy + 4);

            this.renderedSatelliteNodes.push({
              x: sx,
              y: sy,
              lat: latRad / DEG2RAD,
              lon,
              raw: sat,
            });
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    _renderGlobeEventsFast(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0, elapsedSec) {
      const pulse = 0.65 + 0.35 * Math.sin(elapsedSec * 3.5);
      for (let i = 0; i < this.globeEvents.length; i++) {
        const ev = this.globeEvents[i];
        const p = this.projectFast3D(ev.sinLat, ev.cosLat, ev.lon, sinPhi0, cosPhi0, cx, cy, baseRadius);
        if (!p.visible || p.z < 0.14) continue;

        const isStory = Boolean(ev.storyId);
        ctx.fillStyle = isStory
          ? `rgba(250, 204, 21, ${0.34 * pulse})`
          : `rgba(239, 68, 68, ${0.30 * pulse})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (isStory ? 13.5 : 11) + pulse * 3.5, 0, TWO_PI);
        ctx.fill();

        if (isStory) {
          ctx.strokeStyle = '#FACC15';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 9.5 + pulse * 1.5, 0, TWO_PI);
          ctx.stroke();
        }

        ctx.fillStyle = isStory ? '#F59E0B' : '#EF4444';
        ctx.strokeStyle = isStory ? '#FEF08A' : '#FCA5A5';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, isStory ? 7.2 : 6.2, 0, TWO_PI);
        ctx.fill();
        ctx.stroke();

        this.renderedEventPins.push({ x: p.x, y: p.y, raw: ev });
      }
    }

    _render2DMode(ctx, w, h) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
      const padX = 56, padY = 74;
      const plotW = w - padX * 2;
      const plotH = h - padY * 2;

      const bgImg = this.earthImages[this.earthStyle] || this.earthImages.visible_earth;
      if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
        ctx.drawImage(bgImg, padX, padY, plotW, plotH);
      } else {
        ctx.fillStyle = '#040B1A';
        ctx.fillRect(padX, padY, plotW, plotH);
      }

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(padX, padY, plotW, plotH);

      this.renderedScreenPoints = [];
      const limit = Math.min(this.allDayPoints.length, 320);
      for (let i = 0; i < limit; i++) {
        const pt = this.allDayPoints[i];
        const proj = this.project2D(pt.lat, pt.lon, w, h);
        const r = 2.2 + pt.normSize * 4.5;
        ctx.fillStyle = pt.normSize > 0.55 ? 'rgba(250, 204, 21, 0.90)' : 'rgba(249, 115, 22, 0.80)';
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, r, 0, TWO_PI);
        ctx.fill();
        this.renderedScreenPoints.push({ x: proj.x, y: proj.y, raw: pt.raw });
      }
    }
  }

  global.FIRMSGlobe3D = FIRMSGlobe3D;
})(window);
