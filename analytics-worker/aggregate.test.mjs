import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from './src/index.ts';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const env = {
    ALLOWED_ORIGINS: 'https://example.github.io',
    DASHBOARD_PASSWORD: 'test-password',
    DB: {
      prepare(query) {
        let values = [];
        return {
          bind(...args) { values = args; return this; },
          run() {
            const stmt = sql.prepare(query);
            return { results: query.trim().startsWith('SELECT') ? stmt.all(...values) : (stmt.run(...values), []) };
          },
        };
      },
      async batch(statements) {
        sql.exec('BEGIN');
        try {
          const results = statements.map((statement) => statement.run());
          sql.exec('COMMIT');
          return results;
        } catch (error) {
          sql.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
  return { sql, env };
}

function visit(origin = 'https://example.github.io') {
  const request = new Request('https://analytics.example/collect', {
    method: 'POST',
    headers: { Origin: origin },
    body: JSON.stringify({ path: '/private-value-that-must-not-be-read' }),
  });
  Object.defineProperty(request, 'cf', {
    value: { country: 'NO', city: 'Oslo', asn: 123, asOrganization: 'Example ISP' },
  });
  return request;
}

test('stores aggregate counters without request data', async () => {
  const { sql, env } = fixture();
  for (let i = 0; i < 3; i += 1) assert.equal((await worker.fetch(visit(), env)).status, 202);
  const rows = sql.prepare('SELECT * FROM aggregate_visits').all();
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.visits === 3));
  assert.ok(!JSON.stringify(rows).includes('private-value'));
  assert.deepEqual({ ...sql.prepare('SELECT organization, asn, city, country, visits FROM network_location_visits').get() }, {
    organization: 'Example ISP', asn: '123', city: 'Oslo', country: 'NO', visits: 3,
  });
  sql.close();
});

test('rejects unapproved origins', async () => {
  const { sql, env } = fixture();
  assert.equal((await worker.fetch(visit('https://other.example'), env)).status, 403);
  assert.equal(sql.prepare('SELECT COUNT(*) count FROM aggregate_visits').get().count, 0);
  sql.close();
});

test('protects the dashboard and supports a date range', async () => {
  const { sql, env } = fixture();
  await worker.fetch(visit(), env);
  const dashboard = 'https://analytics.example/dashboard';
  assert.equal((await worker.fetch(new Request(dashboard), env)).status, 401);
  const auth = { Authorization: `Basic ${btoa('admin:test-password')}` };
  const response = await worker.fetch(new Request(dashboard, { headers: auth }), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('Oslo'));
  assert.ok(html.includes('Example ISP'));
  assert.ok(html.includes('Total visits<b>1</b>'));
  assert.equal((await worker.fetch(new Request(`${dashboard}?from=bad&to=2026-01-01`, { headers: auth }), env)).status, 400);
  sql.close();
});

test('retention removes counters older than 89 days', async () => {
  const { sql, env } = fixture();
  sql.exec("INSERT INTO aggregate_visits VALUES (date('now','-90 days'),'total','All visits','',7)");
  sql.exec("INSERT INTO network_location_visits VALUES (date('now','-90 days'),'Old ISP','1','Oslo','NO',7)");
  await worker.fetch(visit(), env);
  await worker.scheduled({}, env);
  assert.equal(sql.prepare("SELECT SUM(visits) total FROM aggregate_visits WHERE dimension='total'").get().total, 1);
  assert.equal(sql.prepare('SELECT SUM(visits) total FROM network_location_visits').get().total, 1);
  sql.close();
});
