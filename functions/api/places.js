/**
 * Google Places API Proxy — Cloudflare Worker
 *
 * Two modes:
 *   GET /api/places?input=Pizza+Hut      → Places Autocomplete (search)
 *   GET /api/places?place_id=ChIJ...     → Place Details (rating, reviews)
 *
 * Hides the API key from the browser. Free tier: $200/mo credit.
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  const apiKey = env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500, headers
    });
  }

  // ── Mode 1: Autocomplete (search) ──────────────────────────
  const input = url.searchParams.get('input');
  if (input) {
    try {
      const googleUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
        `?input=${encodeURIComponent(input)}` +
        `&types=establishment` +
        `&key=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(googleUrl);
      const data = await resp.json();
      return new Response(JSON.stringify(data), { status: resp.status, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Places Autocomplete failed', detail: err.message }), {
        status: 502, headers
      });
    }
  }

  // ── Mode 2: Place Details ──────────────────────────────────
  const placeId = url.searchParams.get('place_id');
  if (!placeId) {
    return new Response(JSON.stringify({ error: 'place_id or input required' }), {
      status: 400, headers
    });
  }

  const fields = url.searchParams.get('fields') || 'rating,user_ratings_total,reviews,formatted_address,name';

  try {
    const googleUrl = `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${encodeURIComponent(placeId)}` +
      `&fields=${encodeURIComponent(fields)}` +
      `&key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(googleUrl);
    const data = await resp.json();
    return new Response(JSON.stringify(data), { status: resp.status, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Places API request failed', detail: err.message }), {
      status: 502, headers
    });
  }
}
