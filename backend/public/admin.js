const state = { key: localStorage.getItem('birthdayAdminKey') || '', items: [], deleteTarget: null };
const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'loginView','appView','loginForm','adminKeyInput','loginError','logoutBtn','storageBadge','storageWarning',
  'totalCount','enabledCount','nextBirthday','searchInput','channelFilter','backupBtn','restoreBtn','restoreInput',
  'newBtn','birthdayRows','emptyState','editorDialog','birthdayForm','dialogTitle','closeDialogBtn','birthdayId',
  'usernameInput','channelInput','dateInput','timeInput','avatarInput','messageInput','enabledInput','cancelBtn','saveBtn',
  'confirmDialog','confirmText','toast'
].map((id) => [id, $(id)]));

function toast(message, error = false) {
  els.toast.textContent = message;
  els.toast.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { els.toast.className = 'toast'; }, 3200);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-admin-key': state.key, ...(options.headers || {}) },
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body?.error || body || `Erro HTTP ${response.status}`);
  return body;
}

function showLogin(error = '') {
  els.loginView.classList.remove('hidden');
  els.appView.classList.add('hidden');
  els.loginError.textContent = error;
  els.adminKeyInput.value = state.key;
}
function showApp() {
  els.loginView.classList.add('hidden');
  els.appView.classList.remove('hidden');
}

async function authenticate() {
  try {
    const status = await api('/api/admin/status');
    localStorage.setItem('birthdayAdminKey', state.key);
    showApp();
    updateStatus(status);
    await loadItems();
  } catch (error) {
    showLogin(error.message);
  }
}

function updateStatus(status) {
  const persistent = status.storage?.persistent;
  els.storageBadge.textContent = persistent ? '● Dados persistentes' : '● Armazenamento temporário';
  els.storageBadge.className = `badge ${persistent ? 'ok' : 'warn'}`;
  els.storageWarning.classList.toggle('hidden', persistent);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
}

function getNextBirthday(items) {
  const enabled = items.filter((item) => item.enabled);
  if (!enabled.length) return '—';
  const now = new Date();
  const candidates = enabled.map((item) => {
    const [day, month] = item.date.split('/').map(Number);
    const [hour, minute] = item.time.split(':').map(Number);
    let date = new Date(now.getFullYear(), month - 1, day, hour, minute);
    if (date < now) date = new Date(now.getFullYear() + 1, month - 1, day, hour, minute);
    return { item, date };
  }).sort((a, b) => a.date - b.date);
  const next = candidates[0];
  return `${next.item.username} • ${next.item.date}`;
}

function render() {
  els.totalCount.textContent = state.items.length;
  els.enabledCount.textContent = state.items.filter((item) => item.enabled).length;
  els.nextBirthday.textContent = getNextBirthday(state.items);
  els.emptyState.classList.toggle('hidden', state.items.length > 0);
  els.birthdayRows.innerHTML = state.items.map((item) => `
    <tr>
      <td><div class="person"><img class="avatar" src="${escapeHtml(item.avatarUrl)}" alt=""><div><strong>${escapeHtml(item.username)}</strong><small title="${escapeHtml(item.messageTemplate)}">${escapeHtml(item.messageTemplate)}</small></div></div></td>
      <td>${escapeHtml(item.channel)}</td>
      <td>${escapeHtml(item.date)}</td>
      <td>${escapeHtml(item.time)}</td>
      <td><button class="ghost small toggle-btn" data-id="${item.id}" data-enabled="${item.enabled}"><span class="status ${item.enabled ? '' : 'off'}">${item.enabled ? 'Ativo' : 'Desativado'}</span></button></td>
      <td><div class="actions">
        <button class="secondary small test-btn" data-id="${item.id}">Testar</button>
        <button class="secondary small edit-btn" data-id="${item.id}">Editar</button>
        <button class="ghost small delete-btn" data-id="${item.id}">Excluir</button>
      </div></td>
    </tr>`).join('');
}

async function loadItems() {
  const params = new URLSearchParams();
  if (els.searchInput.value.trim()) params.set('search', els.searchInput.value.trim());
  if (els.channelFilter.value.trim()) params.set('channel', els.channelFilter.value.trim());
  const data = await api(`/api/admin/birthdays?${params}`);
  state.items = data.items;
  render();
}

function openEditor(item = null) {
  els.dialogTitle.textContent = item ? 'Editar aniversário' : 'Adicionar aniversário';
  els.birthdayId.value = item?.id || '';
  els.usernameInput.value = item?.username || '';
  els.channelInput.value = item?.channel || els.channelFilter.value.trim() || '';
  els.dateInput.value = item?.date || '';
  els.timeInput.value = item?.time || '00:00';
  els.avatarInput.value = item?.avatarUrl?.includes('user-default-pictures') ? '' : (item?.avatarUrl || '');
  els.messageInput.value = item?.messageTemplate || '🎉 Feliz aniversário, {nick}!';
  els.enabledInput.checked = item?.enabled !== false;
  els.editorDialog.showModal();
  setTimeout(() => els.usernameInput.focus(), 50);
}

function formatDateInput(value) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

async function saveBirthday(event) {
  event.preventDefault();
  const id = els.birthdayId.value;
  const body = {
    username: els.usernameInput.value,
    channel: els.channelInput.value,
    date: els.dateInput.value,
    time: els.timeInput.value,
    avatarUrl: els.avatarInput.value,
    messageTemplate: els.messageInput.value,
    enabled: els.enabledInput.checked,
  };
  els.saveBtn.disabled = true;
  try {
    await api(id ? `/api/admin/birthdays/${encodeURIComponent(id)}` : '/api/admin/birthdays', {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(body),
    });
    els.editorDialog.close();
    toast(id ? 'Aniversário atualizado.' : 'Aniversário adicionado.');
    await loadItems();
  } catch (error) {
    toast(error.message, true);
  } finally {
    els.saveBtn.disabled = false;
  }
}

async function testBirthday(id, button) {
  button.disabled = true;
  try {
    await api(`/api/admin/birthdays/${encodeURIComponent(id)}/test`, { method: 'POST', body: '{}' });
    toast('Teste enviado ao widget do canal.');
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
}

async function toggleBirthday(id, enabled) {
  try {
    await api(`/api/admin/birthdays/${encodeURIComponent(id)}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled: !enabled }) });
    toast(!enabled ? 'Alerta ativado.' : 'Alerta desativado.');
    await loadItems();
  } catch (error) { toast(error.message, true); }
}

async function confirmDelete(item) {
  state.deleteTarget = item;
  els.confirmText.textContent = `O aniversário de ${item.username} será removido definitivamente.`;
  els.confirmDialog.showModal();
  const result = await new Promise((resolve) => els.confirmDialog.addEventListener('close', () => resolve(els.confirmDialog.returnValue), { once: true }));
  if (result !== 'confirm') return;
  try {
    await api(`/api/admin/birthdays/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    toast('Aniversário excluído.');
    await loadItems();
  } catch (error) { toast(error.message, true); }
}

async function downloadBackup() {
  try {
    const response = await fetch('/api/admin/backup', { headers: { 'x-admin-key': state.key } });
    if (!response.ok) throw new Error((await response.json()).error || 'Falha ao baixar backup.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aniversarios-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) { toast(error.message, true); }
}

async function restoreBackup(file) {
  try {
    const backup = JSON.parse(await file.text());
    const replace = confirm('Clique em OK para substituir a lista atual. Clique em Cancelar para apenas juntar com a lista existente.');
    const result = await api('/api/admin/restore', { method: 'POST', body: JSON.stringify({ backup, replace }) });
    toast(`${result.imported} aniversário(s) restaurado(s).`);
    await loadItems();
  } catch (error) { toast(error.message || 'Backup inválido.', true); }
  finally { els.restoreInput.value = ''; }
}

els.loginForm.addEventListener('submit', (event) => { event.preventDefault(); state.key = els.adminKeyInput.value; authenticate(); });
els.logoutBtn.addEventListener('click', () => { state.key = ''; localStorage.removeItem('birthdayAdminKey'); showLogin(); });
els.newBtn.addEventListener('click', () => openEditor());
els.closeDialogBtn.addEventListener('click', () => els.editorDialog.close());
els.cancelBtn.addEventListener('click', () => els.editorDialog.close());
els.birthdayForm.addEventListener('submit', saveBirthday);
els.dateInput.addEventListener('input', () => { els.dateInput.value = formatDateInput(els.dateInput.value); });
els.backupBtn.addEventListener('click', downloadBackup);
els.restoreBtn.addEventListener('click', () => els.restoreInput.click());
els.restoreInput.addEventListener('change', () => els.restoreInput.files[0] && restoreBackup(els.restoreInput.files[0]));
let filterTimer;
[els.searchInput, els.channelFilter].forEach((input) => input.addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => loadItems().catch((e) => toast(e.message, true)), 250); }));
els.birthdayRows.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const item = state.items.find((entry) => entry.id === button.dataset.id);
  if (!item) return;
  if (button.classList.contains('edit-btn')) openEditor(item);
  if (button.classList.contains('test-btn')) testBirthday(item.id, button);
  if (button.classList.contains('toggle-btn')) toggleBirthday(item.id, button.dataset.enabled === 'true');
  if (button.classList.contains('delete-btn')) confirmDelete(item);
});

if (state.key) authenticate(); else showLogin();
