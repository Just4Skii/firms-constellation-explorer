/**
 * FIRMS CONSTELLATION INTELLIGENCE — SCIENTIFIC CHARTING ENGINE (charts.js)
 * High-precision HTML5 Canvas & SVG analytical visualizations with non-color-alone
 * dual encodings (solid circle vs dashed diamond), tie-preserving peak rings,
 * rank bump comparisons, and Pivotal-Subset Platform Influence (I_p) bars.
 */
(function (global) {
  'use strict';

  function normalizeSeries(arr) {
    if (!arr || arr.length === 0) return [];
    const lo = Math.min(...arr);
    const hi = Math.max(...arr);
    const span = Math.max(hi - lo, 1e-9);
    return arr.map(v => (v - lo) / span);
  }

  function computeTieAveragedRanksDesc(values) {
    // Rank 1 = highest value; ties receive average rank
    const indexed = values.map((v, idx) => ({ v: Number(v), idx }));
    indexed.sort((a, b) => b.v - a.v);
    const ranks = new Array(values.length).fill(0);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j + 1 < indexed.length && Math.abs(indexed[j + 1].v - indexed[i].v) <= 1e-9) {
        j++;
      }
      const avgRank = (i + 1 + j + 1) / 2.0;
      for (let k = i; k <= j; k++) {
        ranks[indexed[k].idx] = avgRank;
      }
      i = j + 1;
    }
    return ranks;
  }

  function renderMetricComparisonChart(canvasId, days, countSeries, frpSeries, topCountDays, topFrpDays, playheadIdx = -1) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !days || days.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 720;
    const h = rect.height || 310;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    const isDark = document.body.classList.contains('theme-dark');
    ctx.fillStyle = isDark ? '#0B1322' : '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    const padL = 56, padR = 56, padT = 38, padB = 46;
    const pw = w - padL - padR;
    const ph = h - padT - padB;

    // Horizontal grid lines
    ctx.strokeStyle = isDark ? '#1E293B' : '#E2E8F0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (ph * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
    }

    const n = days.length;
    const X = (i) => padL + (pw * i) / Math.max(n - 1, 1);
    const Y = (u) => padT + ph * (1 - u);

    const cNorm = normalizeSeries(countSeries);
    const fNorm = normalizeSeries(frpSeries);

    const countColor = isDark ? '#38BDF8' : '#0284C7';
    const frpColor = isDark ? '#F59E0B' : '#EA580C';

    // 1. Draw OBSERVED DETECTION COUNT (Solid Line + Circle Marker ●)
    ctx.strokeStyle = countColor;
    ctx.lineWidth = 2.6;
    ctx.setLineDash([]);
    ctx.beginPath();
    cNorm.forEach((u, i) => (i === 0 ? ctx.moveTo(X(i), Y(u)) : ctx.lineTo(X(i), Y(u))));
    ctx.stroke();

    cNorm.forEach((u, i) => {
      ctx.fillStyle = countColor;
      ctx.beginPath();
      ctx.arc(X(i), Y(u), 4.2, 0, Math.PI * 2);
      ctx.fill();
    });

    // 2. Draw SUMMED OBSERVED FRP (MW) (Dashed Line + Diamond Marker ◆)
    ctx.strokeStyle = frpColor;
    ctx.lineWidth = 2.6;
    ctx.setLineDash([7, 4]);
    ctx.beginPath();
    fNorm.forEach((u, i) => (i === 0 ? ctx.moveTo(X(i), Y(u)) : ctx.lineTo(X(i), Y(u))));
    ctx.stroke();
    ctx.setLineDash([]);

    fNorm.forEach((u, i) => {
      const px = X(i), py = Y(u), sz = 5.0;
      ctx.fillStyle = frpColor;
      ctx.beginPath();
      ctx.moveTo(px, py - sz);
      ctx.lineTo(px + sz, py);
      ctx.lineTo(px, py + sz);
      ctx.lineTo(px - sz, py);
      ctx.closePath();
      ctx.fill();
    });

    // 3. Highlight Tied Top-Day Sets with Rings
    (topCountDays || []).forEach(td => {
      const idx = days.indexOf(td);
      if (idx >= 0) {
        ctx.strokeStyle = countColor;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(X(idx), Y(cNorm[idx]), 11, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    (topFrpDays || []).forEach(td => {
      const idx = days.indexOf(td);
      if (idx >= 0) {
        ctx.strokeStyle = frpColor;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(X(idx), Y(fNorm[idx]), 12, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // 4. Playhead Indicator
    if (playheadIdx >= 0 && playheadIdx < n) {
      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(X(playheadIdx), padT);
      ctx.lineTo(X(playheadIdx), padT + ph);
      ctx.stroke();
    }

    // 5. Axes & Legend
    ctx.font = '600 11px JetBrains Mono, monospace';
    ctx.fillStyle = isDark ? '#94A3B8' : '#475569';
    days.forEach((d, i) => {
      ctx.textAlign = 'center';
      ctx.fillText(d.slice(5), X(i), h - 16);
    });

    // Left Y-axis bounds (Count)
    ctx.textAlign = 'right';
    ctx.fillStyle = countColor;
    ctx.fillText(Math.max(...countSeries).toLocaleString(), padL - 8, padT + 5);
    ctx.fillText(Math.min(...countSeries).toLocaleString(), padL - 8, padT + ph);

    // Right Y-axis bounds (FRP MW)
    ctx.textAlign = 'left';
    ctx.fillStyle = frpColor;
    ctx.fillText(`${Math.round(Math.max(...frpSeries)).toLocaleString()} MW`, w - padR + 8, padT + 5);
    ctx.fillText(`${Math.round(Math.min(...frpSeries)).toLocaleString()} MW`, w - padR + 8, padT + ph);

    // Top Legend
    ctx.textAlign = 'left';
    ctx.font = 'bold 11.5px Inter, sans-serif';
    ctx.fillStyle = countColor;
    ctx.fillText('● Solid: OBSERVED DETECTION COUNT (Left Scale)', padL, 20);
    ctx.fillStyle = frpColor;
    ctx.fillText('◆ Dashed: SUMMED OBSERVED FRP in MW (Right Scale)', padL + 310, 20);

    ctx.restore();
  }

  function renderRankBumpChart(canvasId, days, countSeries, frpSeries) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !days || days.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 620;
    const h = rect.height || 260;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    const isDark = document.body.classList.contains('theme-dark');
    ctx.fillStyle = isDark ? '#0B1322' : '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    const padL = 48, padR = 24, padT = 32, padB = 38;
    const pw = w - padL - padR;
    const ph = h - padT - padB;
    const n = days.length;

    const cRanks = computeTieAveragedRanksDesc(countSeries);
    const fRanks = computeTieAveragedRanksDesc(frpSeries);

    const X = (i) => padL + (pw * i) / Math.max(n - 1, 1);
    const YRank = (r) => padT + ((r - 1) / Math.max(n - 1, 1)) * ph;

    // Rank grid lines (Rank 1 at top, Rank N at bottom)
    ctx.strokeStyle = isDark ? '#1E293B' : '#E2E8F0';
    ctx.font = '10.5px JetBrains Mono, monospace';
    ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
    for (let r = 1; r <= n; r++) {
      const y = YRank(r);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(`#${r}`, padL - 8, y + 3);
    }

    // Draw vertical disagreement connectors per date
    days.forEach((d, i) => {
      const yC = YRank(cRanks[i]);
      const yF = YRank(fRanks[i]);
      if (Math.abs(cRanks[i] - fRanks[i]) > 0.01) {
        ctx.strokeStyle = isDark ? 'rgba(244, 63, 94, 0.55)' : 'rgba(225, 29, 72, 0.45)';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(X(i), yC);
        ctx.lineTo(X(i), yF);
        ctx.stroke();
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = isDark ? '#94A3B8' : '#475569';
      ctx.fillText(d.slice(5), X(i), h - 12);
    });

    const countColor = isDark ? '#38BDF8' : '#0284C7';
    const frpColor = isDark ? '#F59E0B' : '#EA580C';

    // Count Rank Line
    ctx.strokeStyle = countColor;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    cRanks.forEach((r, i) => (i === 0 ? ctx.moveTo(X(i), YRank(r)) : ctx.lineTo(X(i), YRank(r))));
    ctx.stroke();

    // FRP Rank Line
    ctx.strokeStyle = frpColor;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    fRanks.forEach((r, i) => (i === 0 ? ctx.moveTo(X(i), YRank(r)) : ctx.lineTo(X(i), YRank(r))));
    ctx.stroke();
    ctx.setLineDash([]);

    cRanks.forEach((r, i) => {
      ctx.fillStyle = countColor;
      ctx.beginPath(); ctx.arc(X(i), YRank(r), 4.2, 0, Math.PI * 2); ctx.fill();
    });
    fRanks.forEach((r, i) => {
      const px = X(i), py = YRank(r), sz = 4.8;
      ctx.fillStyle = frpColor;
      ctx.beginPath();
      ctx.moveTo(px, py - sz); ctx.lineTo(px + sz, py); ctx.lineTo(px, py + sz); ctx.lineTo(px - sz, py);
      ctx.closePath(); ctx.fill();
    });

    ctx.textAlign = 'left';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.fillStyle = isDark ? '#E2E8F0' : '#0F172A';
    ctx.fillText('DAILY RANK BUMP CHART (#1 = Highest Observed Day · Pink Bars = Rank Shift ΔRank)', padL, 18);

    ctx.restore();
  }

  function renderPlatformInfluenceChart(canvasId, influenceObj, platforms) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !influenceObj) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 620;
    const h = rect.height || 235;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    const isDark = document.body.classList.contains('theme-dark');
    ctx.fillStyle = isDark ? '#0B1322' : '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    const padL = 105, padR = 80, padT = 34, padB = 26;
    const pw = w - padL - padR;
    const ph = h - padT - padB;

    const countInf = influenceObj.detection_count || {};
    const frpInf = influenceObj.summed_frp || {};
    const n = Math.max(platforms.length, 1);
    const rowH = ph / n;

    ctx.strokeStyle = isDark ? '#1E293B' : '#E2E8F0';
    for (let tick = 0; tick <= 1.001; tick += 0.25) {
      const x = padL + tick * pw;
      ctx.beginPath(); ctx.moveTo(x, padT - 4); ctx.lineTo(x, padT + ph); ctx.stroke();
      ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(tick.toFixed(2), x, h - 8);
    }

    platforms.forEach((p, idx) => {
      const yBase = padT + idx * rowH;
      const cInfo = countInf[p] || { I_p: 0, fraction_label: '0/0' };
      const fInfo = frpInf[p] || { I_p: 0, fraction_label: '0/0' };

      ctx.fillStyle = isDark ? '#F8FAFC' : '#0F172A';
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(p, padL - 12, yBase + rowH * 0.54);

      const barH = Math.min(12, rowH * 0.34);
      // Count I_p bar
      const wC = Math.max(2, cInfo.I_p * pw);
      ctx.fillStyle = '#0284C7';
      ctx.fillRect(padL, yBase + rowH * 0.16, wC, barH);
      ctx.font = '10.5px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${cInfo.I_p.toFixed(4)} (${cInfo.fraction_label})`, padL + wC + 6, yBase + rowH * 0.16 + barH - 2);

      // FRP I_p bar
      const wF = Math.max(2, fInfo.I_p * pw);
      ctx.fillStyle = '#EA580C';
      ctx.fillRect(padL, yBase + rowH * 0.54, wF, barH);
      ctx.fillText(`${fInfo.I_p.toFixed(4)} (${fInfo.fraction_label})`, padL + wF + 6, yBase + rowH * 0.54 + barH - 2);
    });

    ctx.textAlign = 'left';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.fillStyle = '#0284C7';
    ctx.fillText('■ Pivotal Influence I_p (Detection Count)', padL, 18);
    ctx.fillStyle = '#EA580C';
    ctx.fillText('■ Pivotal Influence I_p (Summed Observed FRP)', padL + 250, 18);

    ctx.restore();
  }

  global.FIRMSCharts = {
    computeTieAveragedRanksDesc,
    renderMetricComparisonChart,
    renderRankBumpChart,
    renderPlatformInfluenceChart,
  };
})(window);
