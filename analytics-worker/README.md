# Private aggregate visitor analytics

This Cloudflare Worker counts daily visits by approximate country, city, and network provider. It stores aggregate counters in D1 rather than individual visit records.

It does **not** read or store IP addresses, browser fingerprints, page URLs, referrers, user agents, or exact visit times. Cloudflare supplies approximate connection geography to the Worker. Counters older than 89 days are deleted by the daily scheduled task.

## Deploy

1. Install dependencies and log in:

   ```bash
   npm install
   npx wrangler login
   ```

2. Create the D1 database:

   ```bash
   npx wrangler d1 create priyanka-visitor-analytics
   ```

3. Copy the returned database ID into `wrangler.jsonc` as `database_id`.

4. Replace `YOUR_GITHUB_USERNAME` in `ALLOWED_ORIGINS`. If the repository is a project site, the allowed origin is still `https://USERNAME.github.io` because CORS origins do not include URL paths. Add other domains as a comma-separated list.

5. Create the tables:

   ```bash
   npm run db:init
   ```

6. Set a strong password for the private dashboard:

   ```bash
   npx wrangler secret put DASHBOARD_PASSWORD
   ```

7. Test and deploy:

   ```bash
   npm test
   npm run deploy
   ```

8. Copy the deployed Worker URL into `../dist/analytics-config.js`, adding `/collect`. Commit and push that change so GitHub Pages starts counting visits.

The private dashboard is available at `https://YOUR-WORKER.workers.dev/dashboard`. Any username works; the password is the secret set above.
