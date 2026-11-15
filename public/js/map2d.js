/**
 * FIRMS CONSTELLATION INTELLIGENCE — 2D PRECISION HOTSPOT & REGIME ANALYTICAL MAP (map2d.js)
 * Renders Southern Africa & Regional Multi-Resolution Spatial Grids (0.05°, 0.1°, 0.25°, 0.5°, 1.0°)
 * and compares Observed Detection Frequency vs. 1 km Geodesic Clusters (M2c) vs. Summed Observed FRP (MW).
 */
(function (global) {
  'use strict';

  class FIRMSHotspotMap2D {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.geojsonFeatures = [];
      this.cells = [];
      this.metric = 'count'; // 'count' | 'clusters' | 'frp'
      this.resolutionLabel = '1.0deg';
      // Southern Africa bounds: lat [-35, -5], lon [10, 52]
      this.bounds = { latMin: -35, latMax: -6, lonMin: 10, lonMax: 51 };
    }

    setGeoJSON(geojson) {
      if (geojson && Array.isArray(geojson.features)) {
        this.geojsonFeatures = geojson.features;
      }
    }

    update(cells, metric, resolutionLabel) {
      this.cells = cells || [];
      this.metric = metric || 'count';
      this.resolutionLabel = resolutionLabel || '1.0deg';
      this.render();
    }

    project(lat, lon, w, h) {
      const padL = 44, padR = 20, padT = 28, padB = 34;
      const pw = w - padL - padR;
      const ph = h - padT - padB;
      const x = padL + ((lon - this.bounds.lonMin) / (this.bounds.lonMax - this.bounds.lonMin)) * pw;
      const y = padT + ((this.bounds.latMax - lat) / (this.bounds.latMax - this.bounds.latMin)) * ph;
      return { x, y };
    }

    render() {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const w = rect.width || 680;
      const h = rect.height || 380;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (this.canvas.width !== Math.floor(w * dpr) || this.canvas.height !== Math.floor(h * dpr)) {
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
      }

      const ctx = this.ctx;
      ctx.save();
      ctx.scale(dpr, dpr);

      ctx.fillStyle = '#08101E';
      ctx.fillRect(0, 0, w, h);

      const padL = 44, padR = 20, padT = 28, padB = 34;
      const pw = w - padL - padR;
      const ph = h - padT - padB;

      // Grid lines
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
      ctx.lineWidth = 0.8;
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillStyle = '#94A3B8';
      for (let lon = 15; lon <= 50; lon += 5) {
        const p = this.project(-20, lon, w, h);
        ctx.beginPath(); ctx.moveTo(p.x, padT); ctx.lineTo(p.x, padT + ph); ctx.stroke();
        ctx.fillText(`${lon}°E`, p.x - 12, h - 12);
      }
      for (let lat = -30; lat <= -10; lat += 5) {
        const p = this.project(lat, 20, w, h);
        ctx.beginPath(); ctx.moveTo(padL, p.y); ctx.lineTo(padL + pw, p.y); ctx.stroke();
        ctx.fillText(`${lat}°`, 8, p.y + 3);
      }

      // Clip to map frame
      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, padT, pw, ph);
      ctx.clip();

      // Render Southern Africa countries
      ctx.fillStyle = '#132238';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.42)';
      ctx.lineWidth = 1;
      for (let i = 0; i < this.geojsonFeatures.length; i++) {
        const geom = this.geojsonFeatures[i].geometry;
        if (!geom) continue;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : (geom.type === 'MultiPolygon' ? geom.coordinates : []);
        for (let p = 0; p < polys.length; p++) {
          const ring = polys[p][0];
          if (!ring) continue;
          ctx.beginPath();
          for (let k = 0; k < ring.length; k++) {
            const pt = this.project(ring[k][1], ring[k][0], w, h);
            if (k === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }

      // Render top hotspot cells
      if (this.cells.length > 0) {
        const maxVal = Math.max(...this.cells.map(c =>
          this.metric === 'frp' ? c.summed_frp_mw : (this.metric === 'clusters' ? c.spatial_cluster_count : c.detection_count)
        ), 1);

        this.cells.forEach((c, idx) => {
          const val = this.metric === 'frp' ? c.summed_frp_mw : (this.metric === 'clusters' ? c.spatial_cluster_count : c.detection_count);
          const ratio = Math.min(1, val / maxVal);
          const pt = this.project(c.center_lat, c.center_lon, w, h);
          const radius = 5 + ratio * 13;

          if (this.metric === 'frp') {
            ctx.fillStyle = idx < 3 ? 'rgba(250, 204, 21, 0.88)' : 'rgba(234, 88, 12, 0.68)';
            ctx.strokeStyle = '#FEF08A';
          } else if (this.metric === 'clusters') {
            ctx.fillStyle = idx < 3 ? 'rgba(45, 212, 191, 0.88)' : 'rgba(13, 148, 136, 0.68)';
            ctx.strokeStyle = '#99F6E4';
          } else {
            ctx.fillStyle = idx < 3 ? 'rgba(56, 189, 248, 0.88)' : 'rgba(2, 132, 199, 0.68)';
            ctx.strokeStyle = '#BAE6FD';
          }

          ctx.lineWidth = idx < 3 ? 2 : 1;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          if (idx < 5) {
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 10.5px JetBrains Mono, monospace';
            ctx.fillText(`#${c.rank} ${c.cell_id}`, pt.x + radius + 4, pt.y + 3);
          }
        });
      }

      // Callout annotations for the 3 Canonical Regimes
      const regimes = [
        { lat: -24.5, lon: 22.5, label: '(-25,22) Molopo Kalahari', color: '#38BDF8' },
        { lat: -23.5, lon: 24.5, label: '(-24,24) Central Kalahari (FRP)', color: '#FACC15' },
        { lat: -10.5, lon: 39.5, label: '(-11,39) N. Mozambique (Daytime Clusters)', color: '#2DD4BF' },
      ];
      regimes.forEach(rg => {
        const pt = this.project(rg.lat, rg.lon, w, h);
        ctx.strokeStyle = rg.color;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(pt.x - 7, pt.y - 7, 14, 14);
      });

      ctx.restore(); // End clip

      // Header bar
      ctx.fillStyle = '#E2E8F0';
      ctx.font = 'bold 11.5px Inter, sans-serif';
      ctx.fillText(`SOUTHERN AFRICA SPATIAL HOTSPOT DISTRIBUTION · GRID: ${this.resolutionLabel.toUpperCase()}`, padL, 18);

      ctx.restore();
    }
  }

  global.FIRMSHotspotMap2D = FIRMSHotspotMap2D;
})(window);
