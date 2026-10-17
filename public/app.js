import { loadPublicConfig } from './config.js';
import * as Auth from './auth.js';
import * as Repo from './repository.js';
import {
  startOfWeek, shiftWeek, addDays, toISODate, formatWeekRange,
  occupancyPercent, groupSessionsByDate, isSessionBookable,
  formatTime, endTime, bookingStatusMeta, historyActorLabel,
  aggregateDirectionStats, aggregateBookingStatusStats, periodDateRange, validateSessionForm, canAdminMutateBooking,
  canAccessRoute, friendlyErrorMessage
} from './ui.js';

const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');

const state = {
  session: null,
  profile: null,
  route: 'schedule',
  weekStart: startOfWeek(new Date()),
  sessions: [],
  trainers: [],
  loading: false,
  filters: { direction: '', trainerId: '', level: '' },
  authMode: 'login',
  authErrors: {},
  authMessage: '',
  busy: false,
  bookings: [],
  selectedBooking: null,
  bookingHistory: [],
  adminPeriod: '7',
  adminStats: null,
  adminBookings: [],
  adminBookingFilters: { status: '', period: '30' }
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
}

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function closeModal() { modalRoot.innerHTML = ''; }
function showModal(content) { modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal-card">${content}</div></div>`; }

const friendlyError = friendlyErrorMessage;

function roleLabel() { return state.profile?.role === 'admin' ? 'Администратор' : 'Пользователь'; }

function shell(content, active = 'schedule') {
  const isAdmin = state.profile?.role === 'admin';
  const nav = isAdmin
    ? `<button data-route="admin-overview" class="nav-btn ${active==='admin-overview'?'active':''}">Обзор</button>
       <button data-route="admin-schedule" class="nav-btn ${active==='admin-schedule'?'active':''}">Расписание</button>
       <button data-route="admin-bookings" class="nav-btn ${active==='admin-bookings'?'active':''}">Все записи</button>`
    : `<button data-route="schedule" class="nav-btn ${active==='schedule'?'active':''}">Расписание</button>
       <button data-route="bookings" class="nav-btn ${active==='bookings'?'active':''}">Мои записи</button>`;
  return `<div class="app-shell">
    <header class="topbar">
      <div class="brand-wrap"><div class="brand-mark">F</div><div><div class="brand">FitBook</div><div class="brand-sub">запись на тренировки</div></div></div>
      <nav class="main-nav">${nav}</nav>
      <div class="profile-menu"><div class="profile-avatar">${escapeHtml((state.profile?.full_name || 'U').slice(0,1).toUpperCase())}</div><div class="profile-copy"><b>${escapeHtml(state.profile?.full_name || '')}</b><span>${roleLabel()}</span></div><button class="ghost-icon" data-logout title="Выйти">↗</button></div>
    </header>
    <main class="page">${content}</main>
  </div>`;
}

function renderAuth() {
  const register = state.authMode === 'register';
  app.innerHTML = `<div class="auth-page">
    <section class="auth-showcase">
      <div class="auth-logo"><span>F</span> FitBook</div>
      <div class="auth-copy"><div class="eyebrow">ТВОЯ НЕДЕЛЯ ДВИЖЕНИЯ</div><h1>Выбирай тренировку.<br><em>Записывайся за минуту.</em></h1><p>Расписание студии, свободные места и все твои записи в одном аккуратном интерфейсе.</p></div>
      <div class="auth-preview"><div class="preview-chip">Сегодня</div><div><b>18:30 · Yoga Flow</b><span>Мария Орлова · Зал 2</span></div><strong>6 мест</strong></div>
    </section>
    <section class="auth-panel">
      <div class="auth-box">
        <h2>${register ? 'Создать аккаунт' : 'С возвращением'}</h2>
        <p>${register ? 'Зарегистрируйтесь, чтобы записываться на занятия.' : 'Войдите в FitBook, чтобы открыть расписание.'}</p>
        ${state.authMessage ? `<div class="alert info">${escapeHtml(state.authMessage)}</div>` : ''}
        <form id="auth-form" novalidate>
          ${register ? `<label>Имя<input name="fullName" autocomplete="name" placeholder="София Шахвалеева"><small>${escapeHtml(state.authErrors.fullName || '')}</small></label>` : ''}
          <label>Email<input name="email" type="email" autocomplete="email" placeholder="name@example.com"><small>${escapeHtml(state.authErrors.email || '')}</small></label>
          <label>Пароль<input name="password" type="password" autocomplete="${register?'new-password':'current-password'}" placeholder="Минимум 8 символов"><small>${escapeHtml(state.authErrors.password || '')}</small></label>
          ${register ? `<label>Повторите пароль<input name="confirmPassword" type="password" autocomplete="new-password"><small>${escapeHtml(state.authErrors.confirmPassword || '')}</small></label>` : ''}
          <button class="btn primary wide" ${state.busy?'disabled':''}>${state.busy?'Подождите…':register?'Зарегистрироваться':'Войти'}</button>
        </form>
        <div class="auth-switch">${register?'Уже есть аккаунт?':'Нет аккаунта?'} <button data-auth-mode="${register?'login':'register'}">${register?'Войти':'Зарегистрироваться'}</button></div>
      </div>
    </section>
  </div>`;
}

async function loadSchedule() {
  state.loading = true;
  render();
  try {
    const from = toISODate(state.weekStart);
    const to = toISODate(addDays(state.weekStart, 6));
    [state.sessions, state.trainers] = await Promise.all([
      Repo.listWeekSessions(from, to, state.filters),
      Repo.listTrainers({ includeInactive: state.profile?.role === 'admin' })
    ]);
  } catch (error) {
    state.scheduleError = friendlyError(error);
  } finally {
    state.loading = false;
    render();
  }
}

function dayLabel(date) {
  return {
    weekday: new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(date).replace('.', ''),
    day: date.getDate(),
    month: new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(date).replace('.', '')
  };
}

function directionClass(direction) {
  const key = direction.toLowerCase();
  if (key.includes('йог')) return 'yoga';
  if (key.includes('пилат')) return 'pilates';
  if (key.includes('barre')) return 'barre';
  if (key.includes('функ')) return 'functional';
  return 'stretch';
}

function scheduleControls(admin = false) {
  const directions = [...new Set(state.sessions.map(s => s.direction))].sort((a,b)=>a.localeCompare(b,'ru'));
  const levels = [...new Set(state.sessions.map(s => s.level))].sort((a,b)=>a.localeCompare(b,'ru'));
  return `<div class="schedule-toolbar">
    <div class="week-nav"><button class="icon-btn" data-week="-1">←</button><div><span>Неделя</span><b>${formatWeekRange(state.weekStart)}</b></div><button class="icon-btn" data-week="1">→</button><button class="today-btn" data-week="today">Сегодня</button></div>
    <div class="filters-row">
      <select data-filter="direction"><option value="">Все направления</option>${directions.map(x=>`<option value="${escapeHtml(x)}" ${state.filters.direction===x?'selected':''}>${escapeHtml(x)}</option>`).join('')}</select>
      <select data-filter="trainerId"><option value="">Все тренеры</option>${state.trainers.map(t=>`<option value="${t.id}" ${state.filters.trainerId===t.id?'selected':''}>${escapeHtml(t.full_name)}</option>`).join('')}</select>
      <select data-filter="level"><option value="">Любой уровень</option>${levels.map(x=>`<option value="${escapeHtml(x)}" ${state.filters.level===x?'selected':''}>${escapeHtml(x)}</option>`).join('')}</select>
      ${admin ? `<button class="btn primary" data-add-session>+ Добавить занятие</button>` : ''}
    </div>
  </div>`;
}

function sessionCard(session, admin = false) {
  const percent = occupancyPercent(session.booked_count, session.capacity);
  const free = Math.max(0, session.capacity - session.booked_count);
  const bookable = isSessionBookable(session);
  const cancelled = session.status === 'cancelled';
  const passed = new Date(`${session.session_date}T${formatTime(session.start_time)}:00`) <= new Date();
  return `<article class="session-card ${directionClass(session.direction)} ${cancelled?'cancelled':''}">
    <div class="session-accent"></div>
    <div class="session-time"><b>${formatTime(session.start_time)}</b><span>${endTime(session.start_time, session.duration_minutes)}</span></div>
    <div class="session-main"><div class="direction-tag">${escapeHtml(session.direction)}</div><h3>${escapeHtml(session.title)}</h3><div class="session-meta"><span>👤 ${escapeHtml(session.trainer?.full_name || 'Тренер')}</span><span>⌂ ${escapeHtml(session.room)}</span><span>◷ ${session.duration_minutes} мин</span><span>◌ ${escapeHtml(session.level)}</span></div></div>
    <div class="session-capacity"><div class="capacity-top"><span>${session.booked_count}/${session.capacity}</span><b>${cancelled?'Отменено':`${free} мест`}</b></div><div class="progress"><span style="width:${percent}%"></span></div></div>
    <div class="session-action">${admin
      ? `<button class="btn secondary small" data-participants="${session.id}">Участники</button><button class="btn danger-outline small" data-cancel-session="${session.id}" ${cancelled?'disabled':''}>${cancelled?'Отменено':'Отменить'}</button>`
      : `<button class="btn ${bookable?'primary':'muted'} small" data-book="${session.id}" ${bookable?'':'disabled'}>${cancelled?'Отменено':passed?'Прошло':free===0?'Мест нет':'Записаться'}</button>`}
    </div>
  </article>`;
}

function renderSchedulePage(admin = false) {
  const active = admin ? 'admin-schedule' : 'schedule';
  if (state.loading) return shell(`<div class="skeleton hero-skeleton"></div><div class="skeleton block-skeleton"></div>`, active);
  const grouped = groupSessionsByDate(state.sessions);
  const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
  const content = `<section class="hero-strip"><div><div class="eyebrow">РАСПИСАНИЕ НА НЕДЕЛЮ</div><h1>${admin?'Управление занятиями':'Найди свою тренировку'}</h1><p>${admin?'Добавляйте занятия, проверяйте участников и управляйте статусами.':'Выбирайте удобный день, следите за местами и записывайтесь онлайн.'}</p></div><div class="hero-orb">${state.sessions.length}<span>занятий</span></div></section>
    ${scheduleControls(admin)}
    ${state.scheduleError ? `<div class="alert danger">${escapeHtml(state.scheduleError)}</div>` : ''}
    <div class="week-tabs">${days.map((d,i)=>{const x=dayLabel(d);const key=toISODate(d);return `<button data-scroll-day="${key}" class="week-tab ${key===toISODate(new Date())?'today':''}"><span>${x.weekday}</span><b>${x.day}</b><small>${x.month}</small><i>${grouped.get(key)?.length||0}</i></button>`}).join('')}</div>
    <div class="week-list">${days.map(d=>{const key=toISODate(d);const x=dayLabel(d);const list=grouped.get(key)||[];return `<section class="day-section" id="day-${key}"><div class="day-heading"><div><b>${x.weekday}, ${x.day} ${x.month}</b>${key===toISODate(new Date())?'<span>сегодня</span>':''}</div><small>${list.length} ${list.length===1?'занятие':'занятий'}</small></div>${list.length?list.map(s=>sessionCard(s,admin)).join(''):`<div class="day-empty">На этот день занятий нет</div>`}</section>`}).join('')}</div>`;
  return shell(content, active);
}

async function loadAdminBookings() {
  state.loading = true; render();
  try {
    const range = periodDateRange(state.adminBookingFilters.period);
    state.adminBookings = await Repo.adminListBookings({ status: state.adminBookingFilters.status, ...range });
  } catch(error) { state.pageError = friendlyError(error); }
  finally { state.loading = false; render(); }
}

function renderAdminBookings() {
  if (state.loading) return shell(`<div class="skeleton hero-skeleton"></div><div class="skeleton block-skeleton"></div>`, 'admin-bookings');
  const rows = state.adminBookings.map(b=>`<tr><td>#${b.number}</td><td><b>${escapeHtml(b.user?.full_name||'Пользователь')}</b><small>${escapeHtml(b.user?.email||'')}</small></td><td><b>${escapeHtml(b.session?.title||'')}</b><small>${b.session?.session_date||''} · ${formatTime(b.session?.start_time)}</small></td><td>${statusBadge(b.status)}</td><td>${new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(b.created_at))}</td><td class="table-actions">${canAdminMutateBooking(b.status)?`<button class="btn secondary small" data-admin-visited="${b.id}">Посещено</button><button class="btn danger-outline small" data-admin-cancel-booking="${b.id}">Отменить</button>`:'<span class="muted-text">Действия завершены</span>'}</td></tr>`).join('');
  return shell(`<section class="page-head"><div><div class="eyebrow dark">КЛИЕНТСКИЕ ЗАПИСИ</div><h1>Все записи</h1><p>Статусы и действия по всем пользователям FitBook.</p></div><div class="filters-row admin-booking-filters"><select data-admin-booking-status><option value="">Все статусы</option><option value="confirmed" ${state.adminBookingFilters.status==='confirmed'?'selected':''}>Подтверждена</option><option value="visited" ${state.adminBookingFilters.status==='visited'?'selected':''}>Посещено</option><option value="cancelled" ${state.adminBookingFilters.status==='cancelled'?'selected':''}>Отменена</option></select><select data-admin-booking-period><option value="7" ${state.adminBookingFilters.period==='7'?'selected':''}>7 дней</option><option value="30" ${state.adminBookingFilters.period==='30'?'selected':''}>30 дней</option><option value="all" ${state.adminBookingFilters.period==='all'?'selected':''}>Всё время</option></select></div></section>${state.pageError?`<div class="alert danger">${escapeHtml(state.pageError)}</div>`:''}<div class="table-wrap"><table class="admin-table"><thead><tr><th>№</th><th>Клиент</th><th>Занятие</th><th>Статус</th><th>Создана</th><th>Действия</th></tr></thead><tbody>${rows || `<tr><td colspan="6"><div class="day-empty">Записей по выбранным условиям нет</div></td></tr>`}</tbody></table></div>`, 'admin-bookings');
}

async function markVisited(id) {
  if(state.busy)return;state.busy=true;
  try{await Repo.adminMarkVisited(id);toast('Посещение отмечено');await loadAdminBookings();}
  catch(error){toast(friendlyError(error),'danger');}
  finally{state.busy=false;}
}

function confirmAdminCancelBooking(id) {
  showModal(`<button class="modal-x" data-close-modal>×</button><div class="modal-kicker">АДМИНИСТРАТОР</div><h2>Отменить запись клиента?</h2><p class="modal-text">Статус изменится на «Отменена», место вернётся в расписание, а событие сохранится в истории.</p><div class="modal-actions"><button class="btn secondary" data-close-modal>Назад</button><button class="btn danger-outline" data-do-admin-cancel-booking="${id}">Отменить запись</button></div>`);
}

async function doAdminCancelBooking(id){if(state.busy)return;state.busy=true;try{await Repo.cancelBooking(id);closeModal();toast('Запись клиента отменена');await loadAdminBookings();}catch(error){toast(friendlyError(error),'danger');}finally{state.busy=false;}}

async function loadAdminOverview() {
  state.loading = true; render();
  try { state.adminStats = await Repo.adminStats(periodDateRange(state.adminPeriod)); }
  catch (error) { state.pageError = friendlyError(error); }
  finally { state.loading = false; render(); }
}

function renderAdminOverview() {
  if (state.loading || !state.adminStats) return shell(`<div class="skeleton hero-skeleton"></div><div class="skeleton block-skeleton"></div>`, 'admin-overview');
  const stats = state.adminStats;
  const bars = aggregateDirectionStats(stats.sessions, stats.bookings);
  const max = Math.max(1, ...bars.map(x=>x.count));
  const statusStats = aggregateBookingStatusStats(stats.bookings);
  const statusTotal = statusStats.reduce((sum, item) => sum + item.count, 0);
  const confirmedPct = statusTotal ? Math.round((statusStats[0].count / statusTotal) * 100) : 0;
  const visitedPct = statusTotal ? Math.round((statusStats[1].count / statusTotal) * 100) : 0;
  const firstStop = confirmedPct;
  const secondStop = confirmedPct + visitedPct;
  const donutStyle = statusTotal
    ? `background:conic-gradient(#3f7d5d 0 ${firstStop}%,#8069a8 ${firstStop}% ${secondStop}%,#d18462 ${secondStop}% 100%)`
    : 'background:#eef1ee';
  const upcoming = stats.sessions.filter(s=>s.status==='active' && new Date(`${s.session_date}T${formatTime(s.start_time)}:00`) > new Date()).slice(0,5);
  const latest = stats.bookings.slice(0,5);
  return shell(`<section class="admin-hero"><div><div class="eyebrow">АДМИНИСТРАТИВНАЯ ПАНЕЛЬ</div><h1>Обзор FitBook</h1><p>Актуальная статистика по пользователям, занятиям и записям.</p></div><select class="period-select" data-admin-period><option value="7" ${state.adminPeriod==='7'?'selected':''}>Следующие 7 дней</option><option value="30" ${state.adminPeriod==='30'?'selected':''}>Следующие 30 дней</option><option value="all" ${state.adminPeriod==='all'?'selected':''}>Всё время</option></select></section>
  ${state.pageError?`<div class="alert danger">${escapeHtml(state.pageError)}</div>`:''}
  <div class="kpi-grid"><div class="kpi green"><span>Пользователи</span><b>${stats.users}</b><small>роль user</small></div><div class="kpi purple"><span>Занятия</span><b>${stats.sessions.length}</b><small>в периоде</small></div><div class="kpi blue"><span>Активные записи</span><b>${stats.confirmed}</b><small>confirmed</small></div><div class="kpi orange"><span>Средняя заполненность</span><b>${stats.avgOccupancy}%</b><small>по занятиям</small></div></div>
  <div class="mini-kpis"><div><span>Посещено</span><b>${stats.visited}</b></div><div><span>Отменено</span><b>${stats.cancelled}</b></div></div>
  <div class="admin-grid analytics-grid"><section class="panel"><div class="panel-head"><div><div class="eyebrow dark">АНАЛИТИКА</div><h2>Записи по направлениям</h2></div></div><div class="bar-chart">${bars.length?bars.map(x=>`<div class="bar-row"><span>${escapeHtml(x.direction)}</span><div><i style="width:${Math.max(6,(x.count/max)*100)}%"></i></div><b>${x.count}</b></div>`).join(''):'<div class="day-empty">Нет данных за выбранный период</div>'}</div></section><section class="panel"><div class="panel-head"><div><div class="eyebrow dark">СТАТУСЫ</div><h2>Состояние записей</h2></div><span class="chart-total">${statusTotal} всего</span></div><div class="donut-wrap"><div class="donut-chart" style="${donutStyle}"><div><b>${statusTotal}</b><span>записей</span></div></div><div class="donut-legend">${statusStats.map(item=>`<div class="legend-row ${item.status}"><span><i></i>${item.label}</span><b>${item.count}</b></div>`).join('')}</div></div></section></div>
  <section class="panel latest-panel"><div class="panel-head"><div><div class="eyebrow dark">БЛИЖАЙШИЕ</div><h2>Занятия</h2></div><button class="link-btn" data-route="admin-schedule">Открыть расписание →</button></div><div class="compact-list">${upcoming.map(x=>`<div><span class="compact-date">${x.session_date}<b>${formatTime(x.start_time)}</b></span><span><b>${escapeHtml(x.title)}</b><small>${escapeHtml(x.direction)} · ${escapeHtml(x.trainer?.full_name||'')}</small></span><strong>${x.booked_count}/${x.capacity}</strong></div>`).join('') || '<div class="day-empty">Нет ближайших занятий</div>'}</div></section>
  <section class="panel latest-panel"><div class="panel-head"><div><div class="eyebrow dark">ПОСЛЕДНИЕ</div><h2>Записи клиентов</h2></div><button class="link-btn" data-route="admin-bookings">Все записи →</button></div><div class="compact-table">${latest.map(b=>`<div><span>#${b.number}</span><b>${escapeHtml(b.user?.full_name||'Пользователь')}</b><span>${escapeHtml(b.session?.title||'')}</span>${statusBadge(b.status)}</div>`).join('') || '<div class="day-empty">Записей пока нет</div>'}</div></section>`, 'admin-overview');
}

function showAddSessionModal() {
  const defaultDate = toISODate(addDays(state.weekStart, 1));
  showModal(`<button class="modal-x" data-close-modal>×</button><div class="modal-kicker">АДМИНИСТРАТОР</div><h2>Добавить занятие</h2><form id="admin-session-form" class="admin-form"><label>Тренер<select name="trainer_id"><option value="">Выберите тренера</option>${state.trainers.map(t=>`<option value="${t.id}">${escapeHtml(t.full_name)}</option>`).join('')}</select><small data-form-error="trainer_id"></small></label><label>Название<input name="title" placeholder="Yoga Flow"><small data-form-error="title"></small></label><label>Направление<input name="direction" placeholder="Йога"><small data-form-error="direction"></small></label><div class="form-two"><label>Дата<input type="date" name="session_date" value="${defaultDate}"><small data-form-error="session_date"></small></label><label>Время<input type="time" name="start_time" value="18:30"><small data-form-error="start_time"></small></label></div><div class="form-two"><label>Длительность, мин<input type="number" name="duration_minutes" value="60" min="30" max="180"><small data-form-error="duration_minutes"></small></label><label>Вместимость<input type="number" name="capacity" value="12" min="1"><small data-form-error="capacity"></small></label></div><div class="form-two"><label>Зал<input name="room" value="Зал 1"><small data-form-error="room"></small></label><label>Уровень<select name="level"><option>Любой уровень</option><option>Начальный</option><option>Средний</option></select><small data-form-error="level"></small></label></div><div class="modal-actions"><button type="button" class="btn secondary" data-close-modal>Отмена</button><button class="btn primary">Добавить занятие</button></div></form>`);
}

async function submitAdminSession(form) {
  if (state.busy) return;
  const data = Object.fromEntries(new FormData(form));
  const validation = validateSessionForm(data);
  form.querySelectorAll('[data-form-error]').forEach(x=>x.textContent='');
  if (!validation.ok) {
    for (const [key,value] of Object.entries(validation.errors)) form.querySelector(`[data-form-error="${key}"]`)?.append(value);
    return;
  }
  state.busy = true;
  const submit = form.querySelector('button[type="submit"],button:not([type])'); if(submit){submit.disabled=true;submit.textContent='Сохраняем…';}
  try {
    await Repo.adminCreateSession({
      trainer_id:data.trainer_id,title:data.title.trim(),direction:data.direction.trim(),session_date:data.session_date,start_time:data.start_time,
      duration_minutes:Number(data.duration_minutes),room:data.room.trim(),capacity:Number(data.capacity),booked_count:0,level:data.level,status:'active'
    });
    closeModal(); toast('Занятие добавлено в расписание'); await loadSchedule();
  } catch(error) { toast(friendlyError(error),'danger'); }
  finally { state.busy=false; }
}

async function showParticipants(sessionId) {
  try {
    const bookings = await Repo.adminListBookings({ sessionId });
    const active = bookings.filter(b=>b.status!=='cancelled');
    showModal(`<button class="modal-x" data-close-modal>×</button><div class="modal-kicker">УЧАСТНИКИ</div><h2>${active.length} записей</h2><div class="participants-list">${active.map(b=>`<div><span class="profile-avatar tiny">${escapeHtml((b.user?.full_name||'U').slice(0,1))}</span><div><b>${escapeHtml(b.user?.full_name||'Пользователь')}</b><small>${escapeHtml(b.user?.email||'')}</small></div>${statusBadge(b.status)}</div>`).join('') || '<div class="day-empty">На занятие пока никто не записан</div>'}</div><div class="modal-actions"><button class="btn secondary" data-close-modal>Закрыть</button></div>`);
  } catch(error){ toast(friendlyError(error),'danger'); }
}

function confirmCancelSession(id) {
  const session = state.sessions.find(s=>s.id===id);
  showModal(`<button class="modal-x" data-close-modal>×</button><div class="modal-kicker">ОТМЕНА ЗАНЯТИЯ</div><h2>${escapeHtml(session?.title||'Занятие')}</h2><p class="modal-text">Все подтверждённые записи клиентов будут автоматически отменены, а изменения попадут в историю статусов.</p><div class="modal-actions"><button class="btn secondary" data-close-modal>Не отменять</button><button class="btn danger-outline" data-do-cancel-session="${id}">Отменить занятие</button></div>`);
}

async function doCancelSession(id) {
  if(state.busy)return; state.busy=true;
  try{await Repo.adminCancelSession(id);closeModal();toast('Занятие отменено');await loadSchedule();}
  catch(error){toast(friendlyError(error),'danger');}
  finally{state.busy=false;}
}

async function loadMyBookings() {
  state.loading = true; render();
  try { state.bookings = await Repo.listMyBookings(); }
  catch (error) { state.pageError = friendlyError(error); }
  finally { state.loading = false; render(); }
}

function statusBadge(status) {
  const meta = bookingStatusMeta(status);
  return `<span class="status-badge ${meta.className}">${meta.label}</span>`;
}

function renderBookingsPage() {
  if (state.loading) return shell(`<div class="skeleton hero-skeleton"></div><div class="skeleton block-skeleton"></div>`, 'bookings');
  const rows = state.bookings.map(b => {
    const s = b.session;
    return `<article class="booking-card"><div><div class="booking-number">Запись №${b.number}</div><h3>${escapeHtml(s?.title || 'Занятие')}</h3><div class="session-meta"><span>${escapeHtml(s?.direction || '')}</span><span>${s?.session_date || ''}</span><span>${formatTime(s?.start_time)}</span><span>${escapeHtml(s?.trainer?.full_name || '')}</span></div></div><div class="booking-side">${statusBadge(b.status)}<button class="link-btn" data-booking-details="${b.id}">Подробнее →</button></div></article>`;
  }).join('');
  return shell(`<section class="page-head"><div><div class="eyebrow dark">МОИ ЗАПИСИ</div><h1>Тренировки и статусы</h1><p>Здесь сохраняются активные, посещённые и отменённые записи.</p></div><button class="btn primary" data-route="schedule">+ Новая запись</button></section>${state.pageError?`<div class="alert danger">${escapeHtml(state.pageError)}</div>`:''}<div class="booking-list">${rows || `<div class="empty-card"><div class="empty-emoji">✦</div><h2>У вас пока нет записей</h2><p>Выберите занятие в недельном расписании.</p><button class="btn primary" data-route="schedule">Открыть расписание</button></div>`}</div>`, 'bookings');
}

async function openBookingDetails(id) {
  state.loading = true; state.route = 'booking-details'; render();
  try {
    [state.selectedBooking, state.bookingHistory] = await Promise.all([Repo.getBooking(id), Repo.listBookingHistory(id)]);
  } catch (error) { state.pageError = friendlyError(error); }
  finally { state.loading = false; render(); }
}

function renderBookingDetails() {
  if (state.loading) return shell(`<div class="skeleton block-skeleton"></div>`, 'bookings');
  const b = state.selectedBooking; if (!b) return shell(`<div class="empty-card"><h2>Запись не найдена</h2></div>`, 'bookings');
  const s = b.session;
  const history = state.bookingHistory.map(item => {
    const meta = bookingStatusMeta(item.new_status);
    const actor = historyActorLabel(item.changed_by, state.profile.id, state.profile.full_name);
    const when = new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.changed_at));
    return `<div class="timeline-item"><span class="timeline-dot ${meta.className}"></span><div><b>${meta.label}</b><small>${when} · ${escapeHtml(actor)}</small></div></div>`;
  }).join('');
  return shell(`<button class="back-link" data-route="bookings">← Назад к записям</button><section class="detail-grid"><div class="detail-card"><div class="detail-top"><div><div class="booking-number">Запись №${b.number}</div><h1>${escapeHtml(s?.title || 'Занятие')}</h1></div>${statusBadge(b.status)}</div><div class="detail-fields"><div><span>Направление</span><b>${escapeHtml(s?.direction||'')}</b></div><div><span>Дата</span><b>${s?.session_date||''}</b></div><div><span>Время</span><b>${formatTime(s?.start_time)}–${endTime(s?.start_time,s?.duration_minutes)}</b></div><div><span>Тренер</span><b>${escapeHtml(s?.trainer?.full_name||'')}</b></div><div><span>Зал</span><b>${escapeHtml(s?.room||'')}</b></div><div><span>Уровень</span><b>${escapeHtml(s?.level||'')}</b></div></div><div class="comment-box"><span>Комментарий</span><p>${escapeHtml(b.comment || 'Без комментария')}</p></div>${b.status==='confirmed'?`<button class="btn danger-outline" data-cancel-booking="${b.id}">Отменить запись</button>`:''}</div><aside class="history-card"><div class="eyebrow dark">ИСТОРИЯ</div><h2>Изменения статуса</h2><div class="timeline">${history || '<p class="muted-text">История пока пуста.</p>'}</div></aside></section>`, 'bookings');
}

function confirmCancelBooking(id) {
  showModal(`<button class="modal-x" data-close-modal>×</button><div class="modal-kicker">ПОДТВЕРЖДЕНИЕ</div><h2>Отменить запись?</h2><p class="modal-text">После отмены место снова станет доступно другим пользователям.</p><div class="modal-actions"><button class="btn secondary" data-close-modal>Не отменять</button><button class="btn danger-outline" data-do-cancel-booking="${id}">Отменить запись</button></div>`);
}

async function doCancelBooking(id) {
  if (state.busy) return; state.busy = true;
  try { await Repo.cancelBooking(id); closeModal(); toast('Запись отменена'); await openBookingDetails(id); }
  catch (error) { toast(friendlyError(error),'danger'); }
  finally { state.busy = false; }
}

function render() {
  if (!state.session || !state.profile) return renderAuth();
  if (!canAccessRoute(state.profile.role, state.route)) { state.route = state.profile.role === 'admin' ? 'admin-overview' : 'schedule'; }
  if (state.route === 'schedule') app.innerHTML = renderSchedulePage(false);
  else if (state.route === 'bookings') app.innerHTML = renderBookingsPage();
  else if (state.route === 'booking-details') app.innerHTML = renderBookingDetails();
  else if (state.route === 'admin-overview') app.innerHTML = renderAdminOverview();
  else if (state.route === 'admin-schedule') app.innerHTML = renderSchedulePage(true);
  else if (state.route === 'admin-bookings') app.innerHTML = renderAdminBookings();
  else app.innerHTML = shell(`<div class="empty-page"><h2>Раздел готовится</h2></div>`, state.route);
}

async function handleAuthSubmit(form) {
  const data = Object.fromEntries(new FormData(form));
  state.authErrors = {};
  state.authMessage = '';
  state.busy = true;
  renderAuth();
  try {
    if (state.authMode === 'register') {
      const validation = Auth.validateRegistration(data);
      if (!validation.ok) { state.authErrors = validation.errors; return; }
      const result = await Auth.signUp(data);
      if (!result.session) {
        state.authMessage = 'Регистрация выполнена. Подтвердите email, если подтверждение включено в Supabase.';
        state.authMode = 'login';
        return;
      }
    } else {
      await Auth.signIn(data);
    }
    state.session = await Auth.getSession();
    state.profile = await Auth.getProfile();
    state.route = state.profile?.role === 'admin' ? 'admin-overview' : 'schedule';
    if (state.route === 'schedule') await loadSchedule();
    else if (state.route === 'admin-overview') await loadAdminOverview();
  } catch (error) {
    state.authMessage = friendlyError(error);
  } finally {
    state.busy = false;
    render();
  }
}

function showBookingModal(session) {
  const free = Math.max(0, session.capacity - session.booked_count);
  showModal(`<button class="modal-x" data-close-modal>×</button><div class="modal-kicker">НОВАЯ ЗАПИСЬ</div><h2>${escapeHtml(session.title)}</h2><div class="modal-session-summary"><b>${escapeHtml(session.direction)}</b><span>${session.session_date} · ${formatTime(session.start_time)}–${endTime(session.start_time,session.duration_minutes)}</span><span>${escapeHtml(session.trainer?.full_name || '')} · ${escapeHtml(session.room)}</span><strong>${free} свободных мест</strong></div><label class="modal-label">Комментарий<textarea id="booking-comment" placeholder="Например, цель или пожелания"></textarea></label><div class="modal-actions"><button class="btn secondary" data-close-modal>Отмена</button><button class="btn primary" data-confirm-book="${session.id}">Подтвердить запись</button></div>`);
}

async function confirmBooking(sessionId) {
  if (state.busy) return;
  state.busy = true;
  const button = modalRoot.querySelector('[data-confirm-book]');
  if (button) { button.disabled = true; button.textContent = 'Сохраняем…'; }
  try {
    const comment = modalRoot.querySelector('#booking-comment')?.value || '';
    await Repo.bookSession(sessionId, comment);
    closeModal();
    toast('Запись подтверждена');
    await loadSchedule();
  } catch (error) {
    toast(friendlyError(error), 'danger');
    if (button) { button.disabled = false; button.textContent = 'Подтвердить запись'; }
  } finally { state.busy = false; }
}

async function bootstrap() {
  try {
    const config = await loadPublicConfig();
    if (!config.supabaseUrl || !config.supabasePublishableKey) throw new Error('Supabase не настроен.');
    if (!window.supabase?.createClient) throw new Error('Supabase JS не загрузился.');
    const client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
    Auth.initAuth(client);
    Repo.initRepository(client);
    state.session = await Auth.getSession();
    if (state.session) {
      state.profile = await Auth.getProfile();
      state.route = state.profile?.role === 'admin' ? 'admin-overview' : 'schedule';
      if (state.route === 'schedule') await loadSchedule();
      else if (state.route === 'admin-overview') await loadAdminOverview();
    }
    render();
  } catch (error) {
    app.innerHTML = `<div class="fatal"><h1>FitBook не запустился</h1><p>${escapeHtml(error.message)}</p><small>Проверьте .env и подключение к интернету.</small></div>`;
  }
}

document.addEventListener('submit', e => {
  if (e.target.id === 'auth-form') { e.preventDefault(); handleAuthSubmit(e.target); }
  if (e.target.id === 'admin-session-form') { e.preventDefault(); submitAdminSession(e.target); }
});

document.addEventListener('click', async e => {
  const authMode = e.target.closest('[data-auth-mode]');
  if (authMode) { state.authMode = authMode.dataset.authMode; state.authErrors = {}; state.authMessage = ''; return renderAuth(); }
  const route = e.target.closest('[data-route]');
  if (route) { if(!canAccessRoute(state.profile?.role, route.dataset.route)){toast('Недостаточно прав для выполнения операции.','danger');return;} state.route = route.dataset.route; if (state.route==='schedule'||state.route==='admin-schedule') await loadSchedule(); else if(state.route==='bookings') await loadMyBookings(); else if(state.route==='admin-overview') await loadAdminOverview(); else if(state.route==='admin-bookings') await loadAdminBookings(); else render(); return; }
  if (e.target.closest('[data-logout]')) { await Auth.signOut(); state.session=null;state.profile=null;state.route='schedule';return renderAuth(); }
  const week = e.target.closest('[data-week]');
  if (week) { state.weekStart = week.dataset.week==='today' ? startOfWeek(new Date()) : shiftWeek(state.weekStart, Number(week.dataset.week)); await loadSchedule(); return; }
  const scroll = e.target.closest('[data-scroll-day]');
  if (scroll) { document.getElementById(`day-${scroll.dataset.scrollDay}`)?.scrollIntoView({ behavior:'smooth', block:'start' }); return; }
  if(e.target.closest('[data-add-session]')) return showAddSessionModal();
  const participants=e.target.closest('[data-participants]'); if(participants) return showParticipants(participants.dataset.participants);
  const visited=e.target.closest('[data-admin-visited]'); if(visited) return markVisited(visited.dataset.adminVisited);
  const adminCancelBooking=e.target.closest('[data-admin-cancel-booking]'); if(adminCancelBooking) return confirmAdminCancelBooking(adminCancelBooking.dataset.adminCancelBooking);
  const doAdminCancel=e.target.closest('[data-do-admin-cancel-booking]'); if(doAdminCancel) return doAdminCancelBooking(doAdminCancel.dataset.doAdminCancelBooking);
  const cancelSession=e.target.closest('[data-cancel-session]'); if(cancelSession) return confirmCancelSession(cancelSession.dataset.cancelSession);
  const doCancelSessionBtn=e.target.closest('[data-do-cancel-session]'); if(doCancelSessionBtn) return doCancelSession(doCancelSessionBtn.dataset.doCancelSession);
  const book = e.target.closest('[data-book]');
  if (book) { const session=state.sessions.find(s=>s.id===book.dataset.book); if(session) showBookingModal(session); return; }
  const confirm = e.target.closest('[data-confirm-book]');
  if (confirm) return confirmBooking(confirm.dataset.confirmBook);
  const details = e.target.closest('[data-booking-details]'); if(details) return openBookingDetails(details.dataset.bookingDetails);
  const cancelBooking = e.target.closest('[data-cancel-booking]'); if(cancelBooking) return confirmCancelBooking(cancelBooking.dataset.cancelBooking);
  const doCancel = e.target.closest('[data-do-cancel-booking]'); if(doCancel) return doCancelBooking(doCancel.dataset.doCancelBooking);
  if (e.target.closest('[data-close-modal]') || e.target.classList.contains('modal-backdrop')) closeModal();
});

document.addEventListener('change', async e => {
  if (e.target.matches('[data-admin-period]')) { state.adminPeriod=e.target.value; await loadAdminOverview(); return; }
  if (e.target.matches('[data-admin-booking-status]')) { state.adminBookingFilters.status=e.target.value; await loadAdminBookings(); return; }
  if (e.target.matches('[data-admin-booking-period]')) { state.adminBookingFilters.period=e.target.value; await loadAdminBookings(); return; }
  if (e.target.matches('[data-filter]')) {
    state.filters[e.target.dataset.filter] = e.target.value;
    await loadSchedule();
  }
});

bootstrap();
