import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRegistration } from '../public/auth.js';
import { normalizeBooking } from '../public/repository.js';

test('validateRegistration rejects invalid email and password mismatch', () => {
  const result = validateRegistration({ fullName: 'София', email: 'bad-email', password: '12345678', confirmPassword: '87654321' });
  assert.equal(result.ok, false);
  assert.equal(result.errors.email, 'Введите корректный email');
  assert.equal(result.errors.confirmPassword, 'Пароли не совпадают');
});

test('validateRegistration accepts a valid form', () => {
  const result = validateRegistration({ fullName: 'София', email: 'sofia@example.com', password: '12345678', confirmPassword: '12345678' });
  assert.deepEqual(result, { ok: true, errors: {} });
});

test('normalizeBooking preserves joined session, trainer and profile', () => {
  const row = {
    id: 'b1', number: 1001, user_id: 'u1', session_id: 's1', status: 'confirmed', comment: '', created_at: '2026-10-10T10:00:00Z',
    sessions: { id: 's1', title: 'Yoga Flow', trainers: { id: 't1', full_name: 'Мария Орлова' } },
    profiles: { id: 'u1', full_name: 'София', email: 'sofia@example.com' }
  };
  const result = normalizeBooking(row);
  assert.equal(result.session.title, 'Yoga Flow');
  assert.equal(result.session.trainer.full_name, 'Мария Орлова');
  assert.equal(result.user.full_name, 'София');
});
