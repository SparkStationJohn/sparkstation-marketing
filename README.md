# sparkstation-marketing

Marketing landing page and standalone lead-gen tools for SparkStation.
Deployed to [welcome.sparkstation.link](https://welcome.sparkstation.link) via Cloudflare Pages.

## Structure

```
├── index.html                  # Landing page (hero → tools → CTA)
├── tools/
│   └── review-audit/
│       ├── index.html          # Google Review Audit tool
│       ├── widget.js           # Self-contained widget
│       └── style.css           # Widget styles
├── functions/
│   └── api/
│       ├── places.js           # Google Places API proxy (Worker)
│       └── capture.js          # Email capture → Supabase (Worker)
├── assets/                     # Brand assets
├── _headers                    # Cloudflare Pages config
├── wrangler.toml               # Wrangler config
└── README.md
```

## Deploy

```bash
npx wrangler pages deploy . --project-name=sparkstation-marketing
```
