# Priyanka Gawade — research portfolio

A multi-page static portfolio ready for GitHub Pages, with an optional privacy-conscious Cloudflare analytics Worker.

## Preview locally

```bash
python3 -m http.server 4173 --directory dist
```

Then open `http://127.0.0.1:4173/`.

## Publish with GitHub Pages

1. Create a GitHub repository. Use `USERNAME.github.io` for a personal homepage or any repository name for a project site.
2. Push this repository to the `main` branch.
3. In GitHub, open **Settings → Pages** and select **GitHub Actions** as the source.
4. The included workflow publishes the `dist` directory automatically after every push to `main`.

All website links are relative, so the portfolio works both as a user site and beneath a project-repository path.

## Enable private visitor analytics

The `analytics-worker` directory contains a Cloudflare Worker, D1 schema, automated tests, a password-protected dashboard, CORS restrictions, and 89-day retention. Follow [`analytics-worker/README.md`](analytics-worker/README.md) to deploy it.

After deployment, paste the Worker’s `/collect` URL into `dist/analytics-config.js`, then commit and push. Analytics remain disabled while that value is empty.

## Important configuration files

- `.github/workflows/deploy-pages.yml` — GitHub Pages deployment.
- `dist/analytics-config.js` — one-line connection between the site and Worker.
- `analytics-worker/wrangler.jsonc` — Cloudflare Worker, D1, allowed domains, and retention schedule.
- `analytics-worker/schema.sql` — aggregate-only database schema.
