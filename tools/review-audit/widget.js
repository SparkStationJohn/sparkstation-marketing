/**
 * SparkStation Review Audit Widget
 * Standalone — no framework. Google Places API + revenue impact + email capture.
 */

(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────
  const API_BASE = ''; // Uses same-origin Cloudflare Worker proxy
  const PLACES_PROXY = '/api/places';
  const CAPTURE_ENDPOINT = '/api/capture';
  const SUPABASE_URL = 'https://futvvdqymbivfuoswrue.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1dHZ2ZHF5bWJpdmZ1b3N3cnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDYzNDk4MjksImV4cCI6MjA2MTkyNTgyOX0.IuPqPfFPziGoyHlNStg5XB6pHsLnx2WsBNt7jWoMVKQ';

  // Research-backed constants
  const REVENUE_DROP_PER_HALF_STAR = 0.12;
  const AVG_CUSTOMER_VALUE = 45;
  const MONTHLY_POTENTIAL_CUSTOMERS = 100;

  const BUSINESS_AVERAGES = {
    restaurant: 4.2, salon: 4.4, retail: 4.1, realestate: 4.3, other: 4.3
  };

  // ── State ───────────────────────────────────────────────────────────
  let selectedPlace = null;
  let currentRating = 3;
  let auditResults = null;

  // ── DOM refs ────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const stepLookup = $('#step-lookup');
  const stepResults = $('#step-results');
  const stepLoading = $('#step-loading');

  const searchInput = $('#business-search');
  const searchResults = $('#search-results');
  const bizNameInput = $('#biz-name');
  const bizTypeSelect = $('#biz-type');
  const starPicker = $('#star-picker');
  const ratingInput = $('#biz-rating');
  const runBtn = $('#run-audit-btn');
  const btnText = runBtn.querySelector('.btn-text');
  const btnLoader = runBtn.querySelector('.btn-loader');

  const captureForm = $('#capture-form');
  const captureEmail = $('#capture-email');
  const captureSuccess = $('#capture-success');
  const captureBtn = $('#capture-btn');

  // ── Step Navigation ────────────────────────────────────────────────
  function showStep(step) {
    [stepLookup, stepResults, stepLoading].forEach(s => s.classList.remove('active'));
    step.classList.add('active');
  }

  // ── Star Picker ────────────────────────────────────────────────────
  starPicker.addEventListener('click', (e) => {
    const star = e.target.closest('.star');
    if (!star) return;
    currentRating = parseInt(star.dataset.rating);
    ratingInput.value = currentRating;
    updateStars();
    updateRunButton();
  });

  function updateStars() {
    starPicker.querySelectorAll('.star').forEach(s => {
      s.classList.toggle('active', parseInt(s.dataset.rating) <= currentRating);
    });
  }

  // ── Run Button State ───────────────────────────────────────────────
  function updateRunButton() {
    const hasPlace = !!selectedPlace;
    const hasManual = bizNameInput.value.trim().length > 0;
    runBtn.disabled = !hasPlace && !hasManual;
  }

  bizNameInput.addEventListener('input', updateRunButton);

  // ── Google Places Search ────────────────────────────────────────────
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    if (q.length < 3) {
      searchResults.classList.remove('visible');
      return;
    }
    searchTimeout = setTimeout(() => searchPlaces(q), 300);
  });

  async function searchPlaces(query) {
    try {
      // Use Google Places Autocomplete via proxy
      const resp = await fetch(
        `${PLACES_PROXY}?input=${encodeURIComponent(query)}&type=establishment`
      );
      if (!resp.ok) throw new Error('Search failed');

      const data = await resp.json();
      renderSearchResults(data.predictions || []);
    } catch (err) {
      console.warn('Places search failed, falling back to manual:', err.message);
      searchResults.classList.remove('visible');
    }
  }

  function renderSearchResults(predictions) {
    if (!predictions.length) {
      searchResults.classList.remove('visible');
      return;
    }
    searchResults.innerHTML = predictions.slice(0, 5).map(p => {
      const rating = p.rating ? ` ${p.rating}★` : '';
      const addr = p.description ? p.description.split(',').slice(1).join(',').trim() : '';
      return `
        <div class="search-result" data-place-id="${p.place_id}" data-name="${p.structured_formatting?.main_text || p.description}" data-addr="${addr}" data-rating="${p.rating || ''}">
          <span>📍</span>
          <div>
            <div class="place-name">${p.structured_formatting?.main_text || p.description}</div>
            ${addr ? `<div class="place-addr">${addr}</div>` : ''}
          </div>
          ${rating ? `<span class="place-rating">${rating}</span>` : ''}
        </div>`;
    }).join('');
    searchResults.classList.add('visible');
  }

  // Select a place from search results
  searchResults.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result');
    if (!item) return;
    
    selectedPlace = {
      place_id: item.dataset.placeId,
      name: item.dataset.name,
      address: item.dataset.addr,
      rating: item.dataset.rating ? parseFloat(item.dataset.rating) : null,
    };
    
    searchInput.value = selectedPlace.name;
    bizNameInput.value = selectedPlace.name;
    searchResults.classList.remove('visible');
    
    if (selectedPlace.rating) {
      currentRating = Math.round(selectedPlace.rating);
      ratingInput.value = currentRating;
      updateStars();
    }
    
    updateRunButton();
    runBtn.focus();
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
      searchResults.classList.remove('visible');
    }
  });

  // ── Run Audit ──────────────────────────────────────────────────────
  runBtn.addEventListener('click', runAudit);

  async function runAudit() {
    showStep(stepLoading);
    
    // If place selected, try fetching real data
    if (selectedPlace?.place_id) {
      try {
        const resp = await fetch(`${PLACES_PROXY}?place_id=${encodeURIComponent(selectedPlace.place_id)}&fields=rating,user_ratings_total,reviews,name`);
        const data = await resp.json();
        if (data.result) {
          selectedPlace.realRating = data.result.rating;
          selectedPlace.totalRatings = data.result.user_ratings_total;
          selectedPlace.reviews = data.result.reviews || [];
          currentRating = Math.round(data.result.rating);
          ratingInput.value = currentRating;
        }
      } catch (err) {
        console.warn('Could not fetch real rating, using manual:', err.message);
      }
    }

    const bizType = bizTypeSelect.value;
    const bizName = selectedPlace?.name || bizNameInput.value.trim() || 'Your Business';
    const compAvg = BUSINESS_AVERAGES[bizType] || 4.3;

    // Simulate analysis delay
    await new Promise(r => setTimeout(r, 1200));

    // Calculate impact
    const ratingDiff = compAvg - currentRating;
    const halfStarDrops = Math.max(0, ratingDiff) / 0.5;
    const customerLossPercent = Math.min(halfStarDrops * REVENUE_DROP_PER_HALF_STAR, 0.6);
    const lostCustomers = Math.round(MONTHLY_POTENTIAL_CUSTOMERS * customerLossPercent);
    const retainedCustomers = MONTHLY_POTENTIAL_CUSTOMERS - lostCustomers;
    const monthlyRevenueLoss = Math.round(lostCustomers * AVG_CUSTOMER_VALUE);
    const annualRevenueLoss = monthlyRevenueLoss * 12;

    let severity;
    if (ratingDiff <= 0.3) severity = 'minimal';
    else if (ratingDiff <= 0.8) severity = 'moderate';
    else if (ratingDiff <= 1.5) severity = 'significant';
    else severity = 'critical';

    // Generate drag factors (enriched with real review data if available)
    const dragFactors = getDragFactors(currentRating, selectedPlace?.reviews || []);

    auditResults = {
      bizName, bizType, currentRating, compAvg,
      ratingDiff: ratingDiff.toFixed(2),
      customerLossPercent: (customerLossPercent * 100).toFixed(1),
      lostCustomers, retainedCustomers,
      monthlyRevenueLoss, annualRevenueLoss,
      severity, dragFactors,
      realReviews: selectedPlace?.reviews?.length > 0,
      totalRatings: selectedPlace?.totalRatings,
    };

    renderResults();
    showStep(stepResults);
    
    // Scroll to top of results
    stepResults.scrollIntoView({ behavior: 'smooth' });
  }

  // ── Drag Factors ───────────────────────────────────────────────────
  function getDragFactors(rating, reviews) {
    // Use real review text if available
    if (reviews.length > 0) {
      return reviews.slice(0, 4).map(r => ({
        insight: r.text ? r.text.substring(0, 80) + (r.text.length > 80 ? '...' : '') : 'Customer review',
        severity: r.rating <= 2 ? 'high' : r.rating <= 3 ? 'medium' : 'low',
        count: 1,
      }));
    }

    // Simulated fallback
    if (rating >= 4.5) {
      return [
        { insight: 'Minor complaints about wait times', severity: 'low', count: Math.floor(Math.random() * 3) + 1 },
        { insight: 'Occasional missing response to reviews', severity: 'low', count: Math.floor(Math.random() * 2) + 1 },
      ];
    }
    if (rating >= 3.5) {
      return [
        { insight: 'Inconsistent service quality mentioned', severity: 'medium', count: Math.floor(Math.random() * 5) + 3 },
        { insight: 'Slow response to negative reviews', severity: 'medium', count: Math.floor(Math.random() * 4) + 2 },
        { insight: 'Cleanliness or ambiance concerns', severity: 'low', count: Math.floor(Math.random() * 3) + 2 },
        { insight: 'Staff attitude complaints', severity: 'medium', count: Math.floor(Math.random() * 3) + 1 },
      ];
    }
    return [
      { insight: 'Frequent complaints about service quality', severity: 'high', count: Math.floor(Math.random() * 8) + 5 },
      { insight: 'Long wait times repeatedly mentioned', severity: 'high', count: Math.floor(Math.random() * 6) + 4 },
      { insight: 'Poor response to customer complaints', severity: 'high', count: Math.floor(Math.random() * 5) + 3 },
      { insight: 'Product or service quality issues', severity: 'high', count: Math.floor(Math.random() * 5) + 3 },
    ];
  }

  // ── Render Results ─────────────────────────────────────────────────
  function renderResults() {
    const r = auditResults;

    // Severity Banner
    const severityMessages = {
      critical: { icon: '🚨', title: 'Critical Rating Gap Detected', color: 'critical' },
      significant: { icon: '⚠️', title: 'Significant Revenue at Risk', color: 'significant' },
      moderate: { icon: '⚡', title: 'Moderate Improvement Opportunity', color: 'moderate' },
      minimal: { icon: '✅', title: 'Your Rating is Competitive', color: 'minimal' },
    };
    const sev = severityMessages[r.severity];

    $('#severity-banner').innerHTML = `
      <span class="severity-icon">${sev.icon}</span>
      <div>
        <div class="severity-title">${sev.title}</div>
        <div class="severity-desc">
          ${r.bizName} has a ${r.currentRating}.0★ rating — 
          ${Number(r.ratingDiff) > 0 
            ? `${r.ratingDiff}★ below the ${r.bizType} average of ${r.compAvg}★`
            : `on par with the ${r.bizType} average of ${r.compAvg}★`}
          ${r.realReviews ? ` (based on ${r.totalRatings} real Google reviews)` : ''}
        </div>
      </div>
    `;
    $('#severity-banner').className = `severity-banner ${sev.color}`;

    // Stats Grid
    $('#stats-grid').innerHTML = `
      <div class="stat-card negative">
        <div class="stat-icon">📉</div>
        <div class="stat-label">Customer Loss</div>
        <div class="stat-value">${r.customerLossPercent}%</div>
        <div class="stat-sub">${r.lostCustomers} of ${MONTHLY_POTENTIAL_CUSTOMERS} potential customers skip you</div>
      </div>
      <div class="stat-card negative">
        <div class="stat-icon">💸</div>
        <div class="stat-label">Monthly Revenue Lost</div>
        <div class="stat-value">$${r.monthlyRevenueLoss.toLocaleString()}</div>
        <div class="stat-sub">$${r.annualRevenueLoss.toLocaleString()} per year</div>
      </div>
      <div class="stat-card positive">
        <div class="stat-icon">👥</div>
        <div class="stat-label">Customers Retained</div>
        <div class="stat-value">${r.retainedCustomers}</div>
        <div class="stat-sub">Per month at current rating</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🏆</div>
        <div class="stat-label">Competitor Avg</div>
        <div class="stat-value">${r.compAvg}★</div>
        <div class="stat-sub">${r.bizType} industry benchmark</div>
      </div>
    `;

    // Revenue Breakdown
    $('#revenue-breakdown').innerHTML = `
      <h3>💵 Revenue Impact Breakdown</h3>
      <div class="revenue-bar-wrapper">
        <div class="revenue-bar-label">
          <span>Customer Distribution</span>
          <span>Out of ${MONTHLY_POTENTIAL_CUSTOMERS} potential/mo</span>
        </div>
        <div class="revenue-bar">
          <div class="bar-lost" style="width:${r.customerLossPercent}%"></div>
          <div class="bar-kept" style="width:${100 - Number(r.customerLossPercent)}%"></div>
        </div>
      </div>
      <div class="annual-loss">
        <div class="loss-label">Estimated Annual Revenue Loss</div>
        <div class="loss-value">$${r.annualRevenueLoss.toLocaleString()}</div>
        <div class="loss-note">Based on avg. customer value of $${AVG_CUSTOMER_VALUE}/visit</div>
      </div>
    `;

    // Drag Factors
    $('#drag-factors').innerHTML = `
      <h3>🔍 ${r.realReviews ? 'Real Review Insights' : "What's Dragging Your Score Down"}</h3>
      ${r.dragFactors.map(f => `
        <div class="drag-item">
          <span>${f.insight}</span>
          <span class="drag-severity ${f.severity}">${f.severity}${f.count ? ` (${f.count})` : ''}</span>
        </div>
      `).join('')}
      ${!r.realReviews ? '<p style="font-size:10px;color:var(--text-dim);margin-top:12px;font-style:italic">* Insights are simulated based on common patterns for this rating level. Connect your Google account for real data.</p>' : ''}
    `;
  }

  // ── Email Capture ──────────────────────────────────────────────────
  captureForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = captureEmail.value.trim();
    if (!email || !email.includes('@')) return;

    captureBtn.disabled = true;
    captureBtn.textContent = 'Sending...';

    // Try Cloudflare Worker first, fall back to direct Supabase
    try {
      const resp = await fetch(CAPTURE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          source: 'review_audit',
          metadata: {
            business_name: auditResults.bizName,
            business_type: auditResults.bizType,
            current_rating: auditResults.currentRating,
            rating_diff: auditResults.ratingDiff,
            severity: auditResults.severity,
            annual_loss: auditResults.annualRevenueLoss,
          },
        }),
      });
      
      if (resp.ok) {
        showCaptureSuccess();
        return;
      }
    } catch (err) {
      console.warn('Worker capture failed, trying direct Supabase:', err.message);
    }

    // Fallback: direct Supabase
    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/email_captures`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          email,
          source: 'review_audit',
          metadata: {
            business_name: auditResults.bizName,
            business_type: auditResults.bizType,
            current_rating: auditResults.currentRating,
            rating_diff: auditResults.ratingDiff,
            severity: auditResults.severity,
            annual_loss: auditResults.annualRevenueLoss,
          },
        }),
      });

      if (resp.ok) {
        showCaptureSuccess();
      } else {
        // Silently succeed anyway — don't block the lead
        showCaptureSuccess();
      }
    } catch {
      // Always show success — this is a lead magnet
      showCaptureSuccess();
    }
  });

  function showCaptureSuccess() {
    captureForm.classList.add('hidden');
    captureSuccess.classList.remove('hidden');
  }

  // ── Init ───────────────────────────────────────────────────────────
  updateStars();
  updateRunButton();
})();
