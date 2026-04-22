const root = document.getElementById('birthday-se-root');
const shown = new Set();

const fieldData = {
  apiBaseUrl: 'https://SEU-BACKEND.com',
  channel: 'SEU_CANAL',
  timezone: 'America/Sao_Paulo',
  pollSeconds: 30
};

window.addEventListener('onWidgetLoad', (obj) => {
  Object.assign(fieldData, obj.detail.fieldData || {});
  start();
});

function showAlert(item) {
  const key = `${item.channel}-${item.username}-${item.date}-${item.time}`;
  if (shown.has(key)) return;
  shown.add(key);

  const el = document.createElement('div');
  el.className = 'birthday-se-alert';
  el.innerHTML = `
    ${item.avatarUrl ? `<img class="birthday-se-avatar" src="${item.avatarUrl}" alt="avatar">` : ''}
    <div>
      <div class="birthday-se-emoji">🎂🎉</div>
      <div class="birthday-se-title">${item.message}</div>
      <div class="birthday-se-subtitle">Canal: ${item.channel} • ${item.time}</div>
    </div>
  `;
  root.appendChild(el);
  setTimeout(() => el.remove(), 8200);
}

async function poll() {
  try {
    const url = `${fieldData.apiBaseUrl}/api/overlay/alerts?channel=${encodeURIComponent(fieldData.channel)}&timezone=${encodeURIComponent(fieldData.timezone)}`;
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    for (const item of data.due || []) showAlert(item);
  } catch (error) {
    console.error('Birthday widget poll error', error);
  }
}

function start() {
  poll();
  setInterval(poll, Math.max(5, Number(fieldData.pollSeconds || 30)) * 1000);
}
