export function startOfWeek(input) {
  const date = new Date(input);
  date.setHours(12, 0, 0, 0);
  const day = date.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + delta);
  return date;
}

export function shiftWeek(input, deltaWeeks) {
  const date = new Date(input);
  date.setDate(date.getDate() + deltaWeeks * 7);
  return date;
}

export function addDays(input, days) {
  const date = new Date(input);
  date.setDate(date.getDate() + days);
  return date;
}

export function toISODate(input) {
  const date = new Date(input);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatWeekRange(startInput) {
  const start = startOfWeek(startInput);
  const end = addDays(start, 6);
  const startDay = start.getDate();
  const endDay = end.getDate();
  const endMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(end).replace(/^\d+\s+/, '');
  const endYear = end.getFullYear();
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${startDay}–${endDay} ${endMonth} ${endYear}`;
  }
  const startMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(start).replace(/^\d+\s+/, '');
  return `${startDay} ${startMonth} – ${endDay} ${endMonth} ${endYear}`;
}

export function occupancyPercent(booked, capacity) {
  if (!Number.isFinite(capacity) || capacity <= 0) return 0;
  const value = Math.round((Number(booked || 0) / capacity) * 100);
  return Math.max(0, Math.min(100, value));
}

export function aggregateDirectionStats(sessions, bookings) {
  const directionBySession = new Map(sessions.map(session => [session.id, session.direction]));
  const counts = new Map();
  for (const booking of bookings) {
    const direction = directionBySession.get(booking.session_id);
    if (!direction) continue;
    counts.set(direction, (counts.get(direction) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([direction, count]) => ({ direction, count }))
    .sort((a, b) => b.count - a.count || a.direction.localeCompare(b.direction, 'ru'));
}

export function aggregateBookingStatusStats(bookings) {
  const buckets = [
    { status: 'confirmed', label: 'Активные' },
    { status: 'visited', label: 'Посещённые' },
    { status: 'cancelled', label: 'Отменённые' }
  ];
  const counts = new Map(buckets.map(item => [item.status, 0]));
  for (const booking of bookings || []) {
    if (counts.has(booking.status)) counts.set(booking.status, counts.get(booking.status) + 1);
  }
  return buckets.map(item => ({ ...item, count: counts.get(item.status) || 0 }));
}

export function formatDateRu(input, options = {}) {
  return new Intl.DateTimeFormat('ru-RU', options).format(new Date(input));
}

export function formatTime(value) {
  return String(value || '').slice(0, 5);
}

export function endTime(startTime, durationMinutes) {
  const [hours, minutes] = formatTime(startTime).split(':').map(Number);
  const total = hours * 60 + minutes + Number(durationMinutes || 0);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function groupSessionsByDate(sessions) {
  const map = new Map();
  for (const session of sessions || []) {
    if (!map.has(session.session_date)) map.set(session.session_date, []);
    map.get(session.session_date).push(session);
  }
  return map;
}

export function isSessionBookable(session, now = new Date()) {
  if (!session || session.status !== 'active') return false;
  if (Number(session.booked_count || 0) >= Number(session.capacity || 0)) return false;
  const start = new Date(`${session.session_date}T${formatTime(session.start_time)}:00`);
  return start.getTime() > new Date(now).getTime();
}

export function bookingStatusMeta(status) {
  return {
    confirmed: { label: 'Подтверждена', className: 'confirmed' },
    visited: { label: 'Посещено', className: 'visited' },
    cancelled: { label: 'Отменена', className: 'cancelled' }
  }[status] || { label: status || 'Неизвестно', className: 'unknown' };
}

export function historyActorLabel(changedBy, currentUserId, currentUserName = 'Пользователь') {
  if (!changedBy) return 'Система';
  if (changedBy === currentUserId) return currentUserName || 'Пользователь';
  return 'Администратор';
}

export function periodDateRange(period, now = new Date()) {
  if (period === 'all') return { from: '', to: '' };
  const days = period === '30' ? 30 : 7;
  const fromDate = new Date(now);
  fromDate.setHours(12,0,0,0);
  const toDate = addDays(fromDate, days - 1);
  return { from: toISODate(fromDate), to: toISODate(toDate) };
}

export function validateSessionForm(data) {
  const errors = {};
  if (!data.trainer_id) errors.trainer_id = 'Выберите тренера';
  if (!String(data.title || '').trim()) errors.title = 'Введите название';
  if (!String(data.direction || '').trim()) errors.direction = 'Введите направление';
  if (!data.session_date) errors.session_date = 'Выберите дату';
  if (!data.start_time) errors.start_time = 'Выберите время';
  if (!Number(data.duration_minutes) || Number(data.duration_minutes) < 30) errors.duration_minutes = 'Минимум 30 минут';
  if (!String(data.room || '').trim()) errors.room = 'Введите зал';
  if (!Number(data.capacity) || Number(data.capacity) < 1) errors.capacity = 'Укажите вместимость';
  if (!String(data.level || '').trim()) errors.level = 'Укажите уровень';
  return { ok: Object.keys(errors).length === 0, errors };
}

export function canAdminMutateBooking(status) {
  return status === 'confirmed';
}

export function canAccessRoute(role, route) {
  const adminRoute = String(route || '').startsWith('admin-');
  if (adminRoute) return role === 'admin';
  if (role === 'admin' && ['schedule','bookings','booking-details'].includes(route)) return false;
  return ['schedule','bookings','booking-details'].includes(route);
}

export function friendlyErrorMessage(error) {
  const text = String(error?.message || error || '');
  const known = [
    'Свободных мест больше нет.',
    'Вы уже записаны на это занятие.',
    'Это время пересекается с другой вашей записью.',
    'Самостоятельная отмена закрыта за 2 часа до начала занятия.',
    'Занятие больше недоступно для записи.',
    'Недостаточно прав для выполнения операции.',
    'Нельзя записаться на прошедшее занятие.',
    'Эту запись уже нельзя отменить.',
    'Статус этой записи уже является конечным.'
  ];
  const found = known.find(item => text.includes(item));
  if (found) return found;
  if (/invalid login credentials/i.test(text)) return 'Неверный email или пароль.';
  if (/user already registered/i.test(text)) return 'Пользователь с таким email уже зарегистрирован.';
  return 'Не удалось выполнить операцию. Попробуйте ещё раз.';
}
