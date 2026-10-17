let client = null;

export function initRepository(supabaseClient) {
  client = supabaseClient;
}

function db() {
  if (!client) throw new Error('Supabase client не инициализирован.');
  return client;
}

function throwIf(error) {
  if (error) throw error;
}

export function normalizeBooking(row) {
  if (!row) return null;
  const rawSession = row.session || row.sessions || null;
  const rawTrainer = rawSession?.trainer || rawSession?.trainers || null;
  const rawUser = row.user || row.profiles || null;
  return {
    ...row,
    session: rawSession ? { ...rawSession, trainer: rawTrainer } : null,
    user: rawUser
  };
}

export async function listTrainers({ includeInactive = false } = {}) {
  let query = db().from('trainers').select('id,full_name,specialization,is_active').order('full_name');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  throwIf(error);
  return data || [];
}

export async function listWeekSessions(startISO, endISO, filters = {}) {
  let query = db()
    .from('sessions')
    .select('id,trainer_id,title,direction,session_date,start_time,duration_minutes,room,capacity,booked_count,level,status,created_at,trainer:trainers(id,full_name,specialization)')
    .gte('session_date', startISO)
    .lte('session_date', endISO)
    .order('session_date')
    .order('start_time');
  if (filters.direction) query = query.eq('direction', filters.direction);
  if (filters.trainerId) query = query.eq('trainer_id', filters.trainerId);
  if (filters.level) query = query.eq('level', filters.level);
  const { data, error } = await query;
  throwIf(error);
  return data || [];
}

export async function listMyBookings() {
  const { data, error } = await db()
    .from('bookings')
    .select('id,number,user_id,session_id,comment,status,created_at,session:sessions(id,title,direction,session_date,start_time,duration_minutes,room,capacity,booked_count,level,status,trainer:trainers(id,full_name,specialization))')
    .order('created_at', { ascending: false });
  throwIf(error);
  return (data || []).map(normalizeBooking);
}

export async function getBooking(id) {
  const { data, error } = await db()
    .from('bookings')
    .select('id,number,user_id,session_id,comment,status,created_at,session:sessions(id,title,direction,session_date,start_time,duration_minutes,room,capacity,booked_count,level,status,trainer:trainers(id,full_name,specialization))')
    .eq('id', id)
    .single();
  throwIf(error);
  return normalizeBooking(data);
}

export async function bookSession(sessionId, comment = '') {
  const { data, error } = await db().rpc('book_session', { p_session_id: sessionId, p_comment: comment });
  throwIf(error);
  return data;
}

export async function cancelBooking(id) {
  const { data, error } = await db().rpc('cancel_booking', { p_booking_id: id });
  throwIf(error);
  return data;
}

export async function listBookingHistory(bookingId) {
  const { data, error } = await db()
    .from('booking_status_history')
    .select('id,booking_id,old_status,new_status,changed_by,changed_at')
    .eq('booking_id', bookingId)
    .order('changed_at');
  throwIf(error);
  return data || [];
}

export async function adminCreateSession(payload) {
  const { data, error } = await db().from('sessions').insert(payload).select('id').single();
  throwIf(error);
  return data;
}

export async function adminCancelSession(id) {
  const { data, error } = await db().rpc('cancel_session', { p_session_id: id });
  throwIf(error);
  return data;
}

export async function adminMarkVisited(id) {
  const { data, error } = await db().rpc('mark_booking_visited', { p_booking_id: id });
  throwIf(error);
  return data;
}

export async function adminListBookings({ status = '', from = '', to = '', sessionId = '' } = {}) {
  let query = db()
    .from('bookings')
    .select('id,number,user_id,session_id,comment,status,created_at,user:profiles(id,full_name,email),session:sessions!inner(id,title,direction,session_date,start_time,duration_minutes,room,status,trainer:trainers(id,full_name))')
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (from) query = query.gte('session.session_date', from);
  if (to) query = query.lte('session.session_date', to);
  if (sessionId) query = query.eq('session_id', sessionId);
  const { data, error } = await query;
  throwIf(error);
  return (data || []).map(normalizeBooking);
}

export async function adminStats({ from = '', to = '' } = {}) {
  const [{ count: users, error: userError }, sessionsResult, bookingsResult] = await Promise.all([
    db().from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'user'),
    (() => {
      let q = db().from('sessions').select('id,direction,session_date,booked_count,capacity,status,title,start_time,trainer:trainers(full_name)').order('session_date').order('start_time');
      if (from) q = q.gte('session_date', from);
      if (to) q = q.lte('session_date', to);
      return q;
    })(),
    adminListBookings({ from, to })
  ]);
  throwIf(userError);
  throwIf(sessionsResult.error);
  const sessions = sessionsResult.data || [];
  const bookings = bookingsResult || [];
  const confirmed = bookings.filter(b => b.status === 'confirmed').length;
  const visited = bookings.filter(b => b.status === 'visited').length;
  const cancelled = bookings.filter(b => b.status === 'cancelled').length;
  const avgOccupancy = sessions.length
    ? Math.round(sessions.reduce((sum, s) => sum + (s.capacity ? (s.booked_count / s.capacity) * 100 : 0), 0) / sessions.length)
    : 0;
  return { users: users || 0, sessions, bookings, confirmed, visited, cancelled, avgOccupancy };
}
