/**
 * Google Places API Proxy
 * GET /api/places?place_id=...&fields=rating,user_ratings_total,reviews
 * 
 * Hides the API key from the browser. Free tier: $200/mo credit = 8,000+ requests.
 */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  const placeId = url.searchParams.get('place_id');
  if (!placeId) {
    return new Response(JSON.stringify({ error: 'place_id required' }), { 
      status: 400, headers 
    });
  }

  // Fields to request from Places API
  const fields = url.searchParams.get('fields') || 'rating,user_ratings_total,reviews,formatted_address,name';
  const apiKey = env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), { 
      status: 500, headers 
    });
  }

  try {
    const resp = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${encodeURIComponent(fields)}&key=${apiKey}`,
      { method: 'GET' }
    );
    const data = await resp.json();
    return new Response(JSON.stringify(data), { status: resp.status, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Places API request failed', detail: err.message }), { 
      status: 502, headers 
    });
  }
}
