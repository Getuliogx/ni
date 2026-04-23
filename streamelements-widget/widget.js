const root = document.getElementById('birthday-se-root');
const shown = new Map();
let started = false;

const fieldData = {
  apiBaseUrl: 'https://ni-1.onrender.com',
  channel: 'xyzgx',
  timezone: 'America/Sao_Paulo',
  pollSeconds: 10,
  showTestOnLoad: false,
  testMessage: '🎂 TESTE VISUAL DO ALERTA'
};

function applyFieldData(next = {}) { Object.assign(fieldData, next || {}); }
function cleanupShown() {
  const now = Date.now();
  for (const [key, expiresAt] of shown.entries()) if (expiresAt <= now) shown.delete(key);
}
function showAlert(item) {
  if (!root) return;
  const key = item.id || `fallback-${Date.now()}-${Math.random()}`;
  cleanupShown();
  if (shown.has(key)) return;
  shown.set(key, Date.now() + 15000);

  const el = document.createElement('div');
  el.className = 'birthday-se-alert';
  el.innerHTML = `
    ${item.avatarUrl ? `<img class="birthday-se-avatar" src="${item.avatarUrl}" alt="avatar">` : ''}
    <div>
      <div class="birthday-se-emoji">🎂🎉</div>
      <div class="birthday-se-title">${item.message || '🎂 Feliz aniversário!'}</div>
      <div class="birthday-se-subtitle">Canal: ${item.channel || fieldData.channel} • ${item.time || 'agora'}</div>
    </div>
  `;
  root.appendChild(el);
  setTimeout(() => { try { el.remove(); } catch (e) {} }, 8200);
}
async function poll() {
  try {
    const url = `${fieldData.apiBaseUrl}/api/overlay/alerts?channel=${encodeURIComponent(fieldData.channel)}&timezone=${encodeURIComponent(fieldData.timezone)}&_=${Date.now()}`;
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    for (const item of data.due || []) showAlert(item);
  } catch (error) {
    console.error('Birthday widget poll error', error);
  }
}
function start() {
  if (started) return;
  started = true;
  if (String(fieldData.showTestOnLoad) === 'true' || fieldData.showTestOnLoad === true) {
    showAlert({ id: `test_${Date.now()}`, channel: fieldData.channel, username: 'testeviewer', date: '00/00', time: 'agora', message: fieldData.testMessage || '🎂 TESTE VISUAL DO ALERTA', avatarUrl: '' });
  }
  poll();
  setInterval(poll, Math.max(5, Number(fieldData.pollSeconds || 10)) * 1000);
}
window.addEventListener('onWidgetLoad', (obj) => {
  try { applyFieldData(obj.detail.fieldData || {}); } catch (e) {}
  start();
});
window.addEventListener('load', () => { setTimeout(() => { start(); }, 300); });
