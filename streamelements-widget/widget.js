const root = document.getElementById('birthday-se-root');
const shown = new Map();
let started = false;
let pollTimer = null;

const fieldData = {
  apiBaseUrl: 'https://ni-1.onrender.com',
  channel: 'icarolinaporto',
  timezone: 'America/Sao_Paulo',
  pollSeconds: 10,
  showTestOnLoad: false,
  testMessage: '🎂 TESTE VISUAL DO ALERTA'
};

function applyFieldData(next = {}) {
  Object.assign(fieldData, next || {});
}

function cleanupShown() {
  const now = Date.now();
  for (const [key, expiresAt] of shown.entries()) {
    if (expiresAt <= now) shown.delete(key);
  }
}

function showAlert(item) {
  if (!root) return;

  const key = item.id || `fallback-${Date.now()}-${Math.random()}`;
  cleanupShown();

  if (shown.has(key)) return;
  shown.set(key, Date.now() + 15000);

  const safeMessage = item.message || '🎂 Feliz aniversário!';
  const safeChannel = item.channel || fieldData.channel;
  const safeTime = item.time || 'agora';
  const avatarUrl = item.avatarUrl && String(item.avatarUrl).trim()
    ? item.avatarUrl
    : 'https://static-cdn.jtvnw.net/user-default-pictures-uv/215b7342-def9-11e9-9a66-784f43822e80-profile_image-300x300.png';

  const el = document.createElement('div');
  el.className = 'birthday-se-alert';
  el.innerHTML = `
    <img class="birthday-se-avatar" src="${avatarUrl}" alt="avatar" referrerpolicy="no-referrer">
    <div>
      <div class="birthday-se-emoji">🎂🎉</div>
      <div class="birthday-se-title">${safeMessage}</div>
      <div class="birthday-se-subtitle">Canal: ${safeChannel} • ${safeTime}</div>
    </div>
  `;

  root.appendChild(el);

  setTimeout(() => {
    try { el.remove(); } catch (e) {}
  }, 8200);
}

async function poll() {
  try {
    const url = `${fieldData.apiBaseUrl}/api/overlay/alerts?channel=${encodeURIComponent(fieldData.channel)}&timezone=${encodeURIComponent(fieldData.timezone)}&_=${Date.now()}`;
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();

    for (const item of data.due || []) {
      showAlert(item);
    }
  } catch (error) {
    console.error('Birthday widget poll error', error);
  }
}

function start() {
  if (started) return;
  started = true;

  if (String(fieldData.showTestOnLoad) === 'true' || fieldData.showTestOnLoad === true) {
    showAlert({
      id: `test_${Date.now()}_${Math.random()}`,
      channel: fieldData.channel,
      username: 'testeviewer',
      date: '00/00',
      time: 'agora',
      message: fieldData.testMessage || '🎂 TESTE VISUAL DO ALERTA',
      avatarUrl: 'https://static-cdn.jtvnw.net/user-default-pictures-uv/215b7342-def9-11e9-9a66-784f43822e80-profile_image-300x300.png'
    });
  }

  poll();
  pollTimer = setInterval(poll, Math.max(5, Number(fieldData.pollSeconds || 10)) * 1000);
}

window.addEventListener('onWidgetLoad', (obj) => {
  try {
    applyFieldData(obj.detail.fieldData || {});
  } catch (e) {}
  start();
});

window.addEventListener('load', () => {
  setTimeout(() => {
    start();
  }, 300);
});
