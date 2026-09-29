interface Env {
  DB: D1Database;
  DASHBOARD_PASSWORD: string;
  ALLOWED_ORIGINS: string;
}

type CfData = {
  country?: string;
  city?: string;
  asn?: number;
  asOrganization?: string;
};

function allowedOrigins(env: Env) {
  return env.ALLOWED_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean);
}

function cors(request: Request, env: Env): HeadersInit | null {
  const origin = request.headers.get('Origin') ?? '';
  if (!allowedOrigins(env).includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function clean(value: unknown, max: number) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max)
    : null;
}

async function collect(request: Request, env: Env) {
  const headers = cors(request, env);
  if (!headers) return json({ error: 'Origin not allowed' }, 403);

  // Intentionally do not read the request body, URL, referrer, IP, or user agent.
  const day = new Date().toISOString().slice(0, 10);
  const cf = (request.cf ?? {}) as CfData;
  const country = clean(cf.country, 2) || 'Unknown';
  const city = clean(cf.city, 120) || 'Unknown';
  const organization = clean(cf.asOrganization, 200) || 'Unknown';
  const asn = Number.isInteger(cf.asn) ? String(cf.asn) : '';
  const dimensions = [
    ['total', 'All visits', ''],
    ['country', country, ''],
    ['city', city, country],
    ['network', organization, asn],
  ];

  await env.DB.batch([
    ...dimensions.map(([dimension, label, context]) =>
      env.DB.prepare(`INSERT INTO aggregate_visits (day, dimension, label, context, visits)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(day, dimension, label, context)
        DO UPDATE SET visits=aggregate_visits.visits+1`)
        .bind(day, dimension, label, context)),
    env.DB.prepare(`INSERT INTO network_location_visits
      (day, organization, asn, city, country, visits)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(day, organization, asn, city, country)
      DO UPDATE SET visits=network_location_visits.visits+1`)
      .bind(day, organization, asn, city, country),
  ]);

  return json({ ok: true }, 202, headers);
}

function authorized(request: Request, env: Env) {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Basic ')) return false;
  try {
    const credentials = atob(header.slice(6));
    const divider = credentials.indexOf(':');
    return divider >= 0 && credentials.slice(divider + 1) === env.DASHBOARD_PASSWORD;
  } catch {
    return false;
  }
}

function escape(value: unknown) {
  return String(value ?? 'Unknown')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function validDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function ranking(title: string, rows: Record<string, unknown>[], showContext = false) {
  const items = rows.map((row) => `<li><span>${escape(row.label)}${showContext && row.context
    ? ` <small>${escape(row.context)}</small>` : ''}</span><b>${escape(row.total)}</b></li>`).join('');
  return `<section><h2>${title}</h2><ol>${items || '<li>No visits yet.</li>'}</ol></section>`;
}

function breakdown(rows: Record<string, unknown>[]) {
  const body = rows.map((row) => `<tr><td>${escape(row.day)}</td><td>${escape(row.organization)}</td>
    <td>${row.asn ? `AS${escape(row.asn)}` : 'Unknown'}</td><td>${escape(row.city)}</td>
    <td>${escape(row.country)}</td><td><b>${escape(row.visits)}</b></td></tr>`).join('');
  return `<section class="breakdown"><h2>ISP, city and country</h2>
    <p class="note">Daily grouped visits for each network and approximate location.</p>
    <div class="table"><table><thead><tr><th>Date</th><th>ISP / network</th><th>ASN</th>
    <th>City</th><th>Country</th><th>Visits</th></tr></thead>
    <tbody>${body || '<tr><td colspan="6">No visits in this range.</td></tr>'}</tbody></table></div></section>`;
}

async function dashboard(request: Request, env: Env) {
  if (!authorized(request, env)) {
    return new Response('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Priyanka portfolio analytics"' },
    });
  }

  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get('from') ?? shiftDay(today, -6);
  const to = url.searchParams.get('to') ?? today;
  if (!validDay(from) || !validDay(to) || from > to) {
    return new Response('Invalid date range.', { status: 400 });
  }

  const [summary, rows, countries, cities, networks] = await env.DB.batch([
    env.DB.prepare(`SELECT COALESCE(SUM(visits), 0) total FROM aggregate_visits
      WHERE day BETWEEN ? AND ? AND dimension='total'`).bind(from, to),
    env.DB.prepare(`SELECT day, organization, asn, city, country, visits
      FROM network_location_visits WHERE day BETWEEN ? AND ?
      ORDER BY day DESC, visits DESC, organization, city LIMIT 1000`).bind(from, to),
    env.DB.prepare(`SELECT label, SUM(visits) total FROM aggregate_visits
      WHERE day BETWEEN ? AND ? AND dimension='country'
      GROUP BY label ORDER BY total DESC`).bind(from, to),
    env.DB.prepare(`SELECT label, context, SUM(visits) total FROM aggregate_visits
      WHERE day BETWEEN ? AND ? AND dimension='city'
      GROUP BY label, context ORDER BY total DESC LIMIT 50`).bind(from, to),
    env.DB.prepare(`SELECT label, context, SUM(visits) total FROM aggregate_visits
      WHERE day BETWEEN ? AND ? AND dimension='network'
      GROUP BY label, context ORDER BY total DESC LIMIT 50`).bind(from, to),
  ]);

  const total = (summary.results[0] as Record<string, unknown> | undefined)?.total ?? 0;
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>Visitor analytics</title>
  <style>:root{font-family:Arial,sans-serif;color:#191923;background:#f3f0ea}body{max-width:1100px;margin:auto;padding:32px 20px}h1{font:400 clamp(2.5rem,6vw,4.5rem) Georgia,serif}.note,small{color:#66646d}.toolbar{display:flex;justify-content:space-between;align-items:end;gap:12px;flex-wrap:wrap}.filters{display:flex;align-items:end;gap:12px;flex-wrap:wrap;padding:16px;background:#fff;border:1px solid #d4d0c9}.filters label{display:grid;gap:5px;font-size:.8rem;font-weight:700}.filters input,.filters button,.filters a,.danger{padding:9px 11px;font:inherit;border:1px solid #aaa;background:#fff}.filters button{color:#fff;background:#191923;cursor:pointer}.filters a{color:#191923;text-decoration:none}.danger{color:#fff;background:#9f2828;border-color:#9f2828;cursor:pointer}.cards,.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin-top:16px}.card,section{background:#fff;border:1px solid #d4d0c9;padding:20px}.card b{display:block;font:400 3rem Georgia,serif}h2{font:400 1.7rem Georgia,serif;margin-top:0}ol{list-style:none;padding:0;margin:0}li{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-top:1px solid #eee}.breakdown{margin-top:16px}.table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{text-align:left;white-space:nowrap;padding:9px;border-bottom:1px solid #eee}th{color:#fff;background:#595479}</style>
  <body><p class="note">PRIVATE DASHBOARD · ${escape(from)} TO ${escape(to)}</p><h1>Portfolio visitors</h1>
  <div class="toolbar"><form class="filters" method="get"><label>From<input type="date" name="from" value="${escape(from)}" max="${escape(today)}" required></label><label>To<input type="date" name="to" value="${escape(to)}" max="${escape(today)}" required></label><button type="submit">Apply range</button><a href="/dashboard">Last 7 days</a></form>
  <form method="post" action="/dashboard/clear" onsubmit="return confirm('Permanently clear all analytics data?')"><button class="danger" type="submit">Clear all data</button></form></div>
  <div class="cards"><div class="card">Total visits<b>${escape(total)}</b></div></div>
  <p class="note">Each page load counts as a visit. Locations are approximate; no visitor profiles are created.</p>
  ${breakdown(rows.results as Record<string, unknown>[])}
  <div class="grid">${ranking('Countries', countries.results as Record<string, unknown>[])}${ranking('Cities', cities.results as Record<string, unknown>[], true)}${ranking('Networks / ISPs', networks.results as Record<string, unknown>[], true)}</div></body></html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    },
  });
}

async function clearDashboard(request: Request, env: Env) {
  if (!authorized(request, env)) {
    return new Response('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Priyanka portfolio analytics"' },
    });
  }
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    return new Response('Invalid origin', { status: 403 });
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM aggregate_visits'),
    env.DB.prepare('DELETE FROM network_location_visits'),
  ]);
  return new Response(null, { status: 303, headers: { Location: '/dashboard' } });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === 'OPTIONS' && path === '/collect') {
      const headers = cors(request, env);
      return new Response(null, { status: headers ? 204 : 403, headers: headers ?? undefined });
    }
    if (request.method === 'POST' && path === '/collect') return collect(request, env);
    if (request.method === 'GET' && path === '/dashboard') return dashboard(request, env);
    if (request.method === 'POST' && path === '/dashboard/clear') return clearDashboard(request, env);
    if (request.method === 'GET' && path === '/health') return json({ ok: true, mode: 'aggregate' });
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM aggregate_visits WHERE day < date('now','-89 days')"),
      env.DB.prepare("DELETE FROM network_location_visits WHERE day < date('now','-89 days')"),
    ]);
  },
};

export default worker;
