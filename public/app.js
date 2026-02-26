/*
  Один общий файл фронтенд-JS для всех страниц.
  Цель: не дублировать код в HTML и оставить функциональность.
*/

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function setMsg(type, text) {
  const err = $('#errorMessage');
  const ok = $('#successMessage');
  if (err) err.style.display = 'none';
  if (ok) ok.style.display = 'none';
  const box = type === 'error' ? err : ok;
  if (!box) return;
  box.textContent = text;
  box.style.display = 'block';
}

async function currentUser() {
  const { res, data } = await api('/api/current-user');
  return res.ok ? data : null;
}

async function logout() {
  await api('/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  location.href = '/';
}

async function initIndex() {
  const u = await currentUser().catch(() => null);
  if (!u || !u.id) return;

  const nav = $('.navigation ul');
  if (nav) {
    nav.innerHTML = `
      <li><a href="/">Главная</a></li>
      <li><a href="/dashboard">Кабинет</a></li>
      ${u.role === 'admin' ? '<li><a href="/admin">Админ</a></li>' : ''}
      <li><a href="#" id="logoutLink">Выход</a></li>
    `;
    $('#logoutLink')?.addEventListener('click', (e) => (e.preventDefault(), logout()));
  }

  const h2 = $('.welcome-section h2');
  if (h2) h2.textContent = `Добро пожаловать, ${u.username}`;
  $('.cta-section')?.setAttribute('style', 'display:none;');
}

async function initRegister() {
  const u = await currentUser().catch(() => null);
  if (u && u.id) return (location.href = u.role === 'admin' ? '/admin' : '/dashboard');

  $('#registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#username')?.value.trim();
    const email = $('#email')?.value.trim();
    const password = $('#password')?.value;
    const confirmPassword = $('#confirmPassword')?.value;

    if (!username || !email || !password) return setMsg('error', 'Заполните все поля');
    if (password !== confirmPassword) return setMsg('error', 'Пароли не совпадают');

    const { res, data } = await api('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    }).catch(() => ({ res: { ok: false }, data: { error: 'Ошибка соединения' } }));

    if (!res.ok) return setMsg('error', data.error || 'Ошибка регистрации');
    location.href = '/registered';
  });
}

async function initLogin() {
  const u = await currentUser().catch(() => null);
  if (u && u.id) return (location.href = u.role === 'admin' ? '/admin' : '/dashboard');

  $('#loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#username')?.value.trim();
    const password = $('#password')?.value;
    if (!username || !password) return setMsg('error', 'Введите логин и пароль');

    const { res, data } = await api('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).catch(() => ({ res: { ok: false }, data: { error: 'Ошибка соединения' } }));

    if (!res.ok) return setMsg('error', data.error || 'Ошибка входа');
    location.href = data.user?.role === 'admin' ? '/admin' : '/dashboard';
  });
}

async function initDashboard() {
  const u = await currentUser().catch(() => null);
  if (!u || !u.id) return (location.href = '/login');

  const adminLink = $('#adminLink');
  const adminCard = $('#adminCard');
  if (u.role === 'admin') {
    if (adminLink) adminLink.style.display = 'block';
    if (adminCard) adminCard.style.display = 'block';
  } else {
    if (adminLink) adminLink.style.display = 'none';
    if (adminCard) adminCard.style.display = 'none';
  }

  const userInfo = $('#userInfoContent');
  if (userInfo) userInfo.textContent = `ID: ${u.id} | ${u.username} | ${u.role}`;

  $$('.navigation a').forEach((a) => {
    if (a.getAttribute('href') === '#logout') a.addEventListener('click', (e) => (e.preventDefault(), logout()));
  });

  window.logout = logout; // совместимость со старыми onclick
}

async function initAdmin() {
  const u = await currentUser().catch(() => null);
  if (!u || u.role !== 'admin') return (location.href = '/dashboard');

  window.logout = logout;

  const info = $('#adminInfoContent');
  if (info) info.textContent = `ID: ${u.id} | ${u.username} | admin`;

  const tbody = $('#usersTableBody');
  const total = $('#totalUsers');
  let users = [];

  async function load() {
    const r = await api('/api/users').catch(() => ({ res: { ok: false }, data: [] }));
    if (!r.res.ok) return;
    users = Array.isArray(r.data) ? r.data : [];
    if (total) total.textContent = `Всего пользователей: ${users.length}`;
    if (!tbody) return;
    tbody.innerHTML = users
      .map((x) => `
        <tr>
          <td>${x.id}</td>
          <td>${x.username}</td>
          <td>${x.email}</td>
          <td>${x.role}</td>
          <td>${new Date(x.created_at).toLocaleString('ru-RU')}</td>
          <td><button class="btn btn-small btn-danger" data-del="${x.id}">Удалить</button></td>
        </tr>
      `)
      .join('');

    $$('button[data-del]', tbody).forEach((b) =>
      b.addEventListener('click', async () => {
        const id = Number(b.getAttribute('data-del'));
        if (!confirm('Удалить пользователя?')) return;
        const d = await api(`/api/users/${id}`, { method: 'DELETE' });
        if (!d.res.ok) alert(d.data.error || 'Ошибка');
        else load();
      })
    );
  }

  window.loadUsers = load; // совместимость
  await load();
}

async function initRegistered() {
  $('#goLogin')?.addEventListener('click', () => (location.href = '/login'));

  const btn = $('#goAdmin');
  if (!btn) return;

  const u = await currentUser().catch(() => null);
  if (u && u.role === 'admin') {
    btn.disabled = false;
    btn.addEventListener('click', () => (location.href = '/admin'));
  } else {
    btn.disabled = true;
    btn.addEventListener('click', (e) => e.preventDefault());
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body?.getAttribute('data-page');
  if (page === 'index') initIndex();
  if (page === 'register') initRegister();
  if (page === 'login') initLogin();
  if (page === 'dashboard') initDashboard();
  if (page === 'admin') initAdmin();
  if (page === 'registered') initRegistered();
});
