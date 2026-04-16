/**
 * MotoMate QA Audit (API smoke test)
 *
 * Usage:
 *   MOTOMATE_API_URL="http://127.0.0.1:3001" MOTOMATE_TOKEN="..." node scripts/qa-audit.mjs
 *
 * Notes:
 * - The backend is mounted at /api (we append it automatically if needed).
 * - Requires a valid JWT in MOTOMATE_TOKEN unless your backend is running with local auth-bypass.
 */
import process from 'node:process';

const rawBase = process.env.MOTOMATE_API_URL || process.env.VITE_API_URL || 'http://127.0.0.1:3001';
const base = String(rawBase).replace(/\/+$/, '').endsWith('/api')
  ? String(rawBase).replace(/\/+$/, '')
  : `${String(rawBase).replace(/\/+$/, '')}/api`;

const token = process.env.MOTOMATE_TOKEN || '';

function hdrs(extra = {}) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function req(method, path, body) {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method,
    headers: hdrs(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  if (!res.ok) {
    const msg = typeof json === 'object' && json && json.error ? json.error : `HTTP ${res.status}`;
    const err = new Error(`${method} ${path} failed: ${msg}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }

  return json;
}

function row(feature, status, details) {
  return { feature, status, details };
}

function printTable(rows) {
  const pad = (s, n) => String(s).padEnd(n, ' ');
  const c1 = Math.max(...rows.map(r => r.feature.length), 'Functional'.length);
  const c2 = Math.max(...rows.map(r => r.status.length), 'Status'.length);
  console.log(`${pad('Functional', c1)} | ${pad('Status', c2)} | Details`);
  console.log(`${'-'.repeat(c1)}-|-${'-'.repeat(c2)}-|-${'-'.repeat(40)}`);
  for (const r of rows) console.log(`${pad(r.feature, c1)} | ${pad(r.status, c2)} | ${r.details}`);
}

async function main() {
  const rows = [];
  console.log(`API base: ${base}`);
  console.log(`Token present: ${Boolean(token)}`);

  // 1) Health
  try {
    const health = await req('GET', '/health');
    rows.push(row('Health', 'OK', `status=${health?.status || 'n/a'}`));
  } catch (e) {
    rows.push(row('Health', 'FAIL', e.message));
    printTable(rows);
    process.exitCode = 1;
    return;
  }

  // 2) Profile read
  let profile = null;
  try {
    profile = await req('GET', '/users/profile');
    rows.push(row('Profile GET', 'OK', `id=${profile?.id || 'n/a'}`));
  } catch (e) {
    rows.push(row('Profile GET', 'FAIL', `${e.message} (status=${e.status ?? 'n/a'})`));
    printTable(rows);
    process.exitCode = 1;
    return;
  }

  // 3) Profile update (non-destructive)
  try {
    const payload = {
      // send full set of fields that MainApp commonly uses
      name: profile?.name ?? 'MotoRider',
      age: profile?.age ?? 25,
      city: profile?.city ?? 'Moscow',
      bike: profile?.bike ?? '',
      has_bike: profile?.has_bike ?? false,
      gender: profile?.gender ?? 'male',
      about: profile?.about ?? 'QA audit update',
      temp: profile?.temp ?? 'Спокойный',
      music: profile?.music ?? 'Рок',
      equip: profile?.equip ?? 'Только шлем',
      goal: profile?.goal ?? 'Только поездки',
      // include interests like frontend (backend should ignore it safely)
      interests: [
        { id: 'style', label: 'Стиль', value: profile?.temp ?? 'Спокойный', icon: 'Gauge' },
      ],
      // keep images consistent
      images: Array.isArray(profile?.images) ? profile.images : [],
      image: profile?.image ?? null,
    };
    await req('PUT', '/users/profile', payload);
    rows.push(row('Profile PUT', 'OK', 'Accepted and saved allow-listed fields'));
  } catch (e) {
    rows.push(row('Profile PUT', 'FAIL', `${e.message} (body=${JSON.stringify(e.body)})`));
  }

  // 4) Users list (for search/map)
  let users = [];
  try {
    const params = new URLSearchParams();
    if (profile?.city) params.set('city', profile.city);
    const oppositeGender =
      profile?.gender === 'male' ? 'female' : profile?.gender === 'female' ? 'male' : undefined;
    if (oppositeGender) params.set('gender', oppositeGender);
    users = await req('GET', `/users?${params.toString()}`);
    rows.push(row('Users GET', 'OK', `count=${Array.isArray(users) ? users.length : 0}`));
  } catch (e) {
    rows.push(row('Users GET', 'FAIL', e.message));
  }

  // 5) Like + match signal (best-effort)
  try {
    const target = Array.isArray(users) ? users.find(u => u?.id) : null;
    if (!target) {
      rows.push(row('Likes POST', 'SKIP', 'No target user found (seed more users)'));
    } else {
      const likeRes = await req('POST', '/likes', { to_user_id: target.id });
      const isMatch = Boolean(likeRes?.isMatch);
      const chatId = likeRes?.chat?.id;
      rows.push(row('Likes POST', 'OK', `liked=${likeRes?.liked} isMatch=${isMatch} chatId=${chatId || 'n/a'}`));
    }
  } catch (e) {
    rows.push(row('Likes POST', 'FAIL', e.message));
  }

  // 6) Chats + messages
  try {
    const chats = await req('GET', '/chats');
    rows.push(row('Chats GET', 'OK', `count=${Array.isArray(chats) ? chats.length : 0}`));

    const chat = Array.isArray(chats) ? chats.find(c => c?.id) : null;
    if (!chat) {
      rows.push(row('Messages GET', 'SKIP', 'No chats found'));
      rows.push(row('Messages POST', 'SKIP', 'No chats found'));
    } else {
      const msgs = await req('GET', `/chats/${chat.id}/messages`);
      rows.push(row('Messages GET', 'OK', `count=${Array.isArray(msgs) ? msgs.length : 0}`));

      const sent = await req('POST', `/chats/${chat.id}/messages`, { text: `QA ping ${Date.now()}`, type: 'text' });
      rows.push(row('Messages POST', 'OK', `messageId=${sent?.id || 'n/a'}`));
    }
  } catch (e) {
    rows.push(row('Chats/Messages', 'FAIL', e.message));
  }

  printTable(rows);

  const failed = rows.some(r => r.status === 'FAIL');
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

