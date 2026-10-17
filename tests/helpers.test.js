import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startOfWeek,
  shiftWeek,
  formatWeekRange,
  occupancyPercent,
  aggregateDirectionStats,
  aggregateBookingStatusStats
} from '../public/ui.js';

test('startOfWeek returns Monday for a Friday', () => {
  assert.equal(startOfWeek(new Date('2026-10-16T12:00:00')).toISOString().slice(0, 10), '2026-10-12');
});

test('startOfWeek keeps Monday unchanged', () => {
  assert.equal(startOfWeek(new Date('2026-10-12T12:00:00')).toISOString().slice(0, 10), '2026-10-12');
});

test('shiftWeek moves exactly seven days', () => {
  assert.equal(shiftWeek(new Date('2026-10-12T12:00:00'), 1).toISOString().slice(0, 10), '2026-10-19');
  assert.equal(shiftWeek(new Date('2026-10-12T12:00:00'), -1).toISOString().slice(0, 10), '2026-10-05');
});

test('formatWeekRange formats same-month range in Russian', () => {
  assert.equal(formatWeekRange(new Date('2026-10-12T12:00:00')), '12–18 октября 2026');
});

test('occupancyPercent clamps invalid and over-capacity values', () => {
  assert.equal(occupancyPercent(6, 12), 50);
  assert.equal(occupancyPercent(13, 12), 100);
  assert.equal(occupancyPercent(3, 0), 0);
});

test('aggregateDirectionStats counts bookings by session direction', () => {
  const sessions = [
    { id: 's1', direction: 'Йога' },
    { id: 's2', direction: 'Растяжка' },
    { id: 's3', direction: 'Йога' }
  ];
  const bookings = [
    { session_id: 's1', status: 'confirmed' },
    { session_id: 's1', status: 'visited' },
    { session_id: 's2', status: 'cancelled' },
    { session_id: 's3', status: 'confirmed' }
  ];
  assert.deepEqual(aggregateDirectionStats(sessions, bookings), [
    { direction: 'Йога', count: 3 },
    { direction: 'Растяжка', count: 1 }
  ]);
});

test('aggregateBookingStatusStats returns all lifecycle buckets including zero counts', () => {
  const bookings = [
    { status: 'confirmed' },
    { status: 'confirmed' },
    { status: 'visited' },
    { status: 'cancelled' }
  ];
  assert.deepEqual(aggregateBookingStatusStats(bookings), [
    { status: 'confirmed', label: 'Активные', count: 2 },
    { status: 'visited', label: 'Посещённые', count: 1 },
    { status: 'cancelled', label: 'Отменённые', count: 1 }
  ]);
  assert.deepEqual(aggregateBookingStatusStats([]), [
    { status: 'confirmed', label: 'Активные', count: 0 },
    { status: 'visited', label: 'Посещённые', count: 0 },
    { status: 'cancelled', label: 'Отменённые', count: 0 }
  ]);
});

test('groupSessionsByDate creates buckets only for supplied sessions', async () => {
  const { groupSessionsByDate } = await import('../public/ui.js');
  const result = groupSessionsByDate([
    { id: '1', session_date: '2026-10-12' },
    { id: '2', session_date: '2026-10-12' },
    { id: '3', session_date: '2026-10-14' }
  ]);
  assert.equal(result.get('2026-10-12').length, 2);
  assert.equal(result.get('2026-10-14').length, 1);
});

test('isSessionBookable blocks full, cancelled and past sessions', async () => {
  const { isSessionBookable } = await import('../public/ui.js');
  const now = new Date('2026-10-10T12:00:00');
  assert.equal(isSessionBookable({ session_date:'2026-10-11', start_time:'10:00', capacity:12, booked_count:2, status:'active' }, now), true);
  assert.equal(isSessionBookable({ session_date:'2026-10-11', start_time:'10:00', capacity:12, booked_count:12, status:'active' }, now), false);
  assert.equal(isSessionBookable({ session_date:'2026-10-11', start_time:'10:00', capacity:12, booked_count:2, status:'cancelled' }, now), false);
  assert.equal(isSessionBookable({ session_date:'2026-10-09', start_time:'10:00', capacity:12, booked_count:2, status:'active' }, now), false);
});

test('bookingStatusMeta returns Russian labels for lifecycle states', async () => {
  const { bookingStatusMeta } = await import('../public/ui.js');
  assert.deepEqual(bookingStatusMeta('confirmed'), { label: 'Подтверждена', className: 'confirmed' });
  assert.deepEqual(bookingStatusMeta('visited'), { label: 'Посещено', className: 'visited' });
  assert.deepEqual(bookingStatusMeta('cancelled'), { label: 'Отменена', className: 'cancelled' });
});

test('historyActorLabel distinguishes current user and administrator', async () => {
  const { historyActorLabel } = await import('../public/ui.js');
  assert.equal(historyActorLabel('u1', 'u1', 'София'), 'София');
  assert.equal(historyActorLabel('admin1', 'u1', 'София'), 'Администратор');
  assert.equal(historyActorLabel(null, 'u1', 'София'), 'Система');
});

test('periodDateRange returns 7 and 30 day inclusive ranges', async () => {
  const { periodDateRange } = await import('../public/ui.js');
  const now = new Date('2026-10-10T12:00:00');
  assert.deepEqual(periodDateRange('7', now), { from: '2026-10-10', to: '2026-10-16' });
  assert.deepEqual(periodDateRange('30', now), { from: '2026-10-10', to: '2026-11-08' });
  assert.deepEqual(periodDateRange('all', now), { from: '', to: '' });
});

test('validateSessionForm requires all admin schedule fields', async () => {
  const { validateSessionForm } = await import('../public/ui.js');
  const result = validateSessionForm({ trainer_id:'', title:'', direction:'', session_date:'', start_time:'', duration_minutes:'', room:'', capacity:'', level:'' });
  assert.equal(result.ok, false);
  assert.equal(result.errors.trainer_id, 'Выберите тренера');
  assert.equal(result.errors.session_date, 'Выберите дату');
  assert.equal(result.errors.capacity, 'Укажите вместимость');
});

test('validateSessionForm accepts valid admin session data', async () => {
  const { validateSessionForm } = await import('../public/ui.js');
  const result = validateSessionForm({ trainer_id:'t1', title:'Yoga Flow', direction:'Йога', session_date:'2026-10-20', start_time:'18:30', duration_minutes:'60', room:'Зал 2', capacity:'12', level:'Средний' });
  assert.deepEqual(result, { ok:true, errors:{} });
});

test('canAdminMutateBooking allows actions only for confirmed status', async () => {
  const { canAdminMutateBooking } = await import('../public/ui.js');
  assert.equal(canAdminMutateBooking('confirmed'), true);
  assert.equal(canAdminMutateBooking('visited'), false);
  assert.equal(canAdminMutateBooking('cancelled'), false);
});

test('canAccessRoute blocks admin routes for ordinary user', async () => {
  const { canAccessRoute } = await import('../public/ui.js');
  assert.equal(canAccessRoute('user', 'schedule'), true);
  assert.equal(canAccessRoute('user', 'bookings'), true);
  assert.equal(canAccessRoute('user', 'admin-overview'), false);
  assert.equal(canAccessRoute('user', 'admin-bookings'), false);
  assert.equal(canAccessRoute('admin', 'admin-overview'), true);
});

test('friendlyError maps known database errors and hides unknown details', async () => {
  const { friendlyErrorMessage } = await import('../public/ui.js');
  assert.equal(friendlyErrorMessage(new Error('P0001: Свободных мест больше нет.')), 'Свободных мест больше нет.');
  assert.equal(friendlyErrorMessage(new Error('duplicate key value violates secret_table_pkey')), 'Не удалось выполнить операцию. Попробуйте ещё раз.');
});
