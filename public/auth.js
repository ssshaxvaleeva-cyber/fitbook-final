let client = null;

export function initAuth(supabaseClient) {
  client = supabaseClient;
}

function requireClient() {
  if (!client) throw new Error('Supabase client не инициализирован.');
  return client;
}

export function validateRegistration({ fullName = '', email = '', password = '', confirmPassword = '' }) {
  const errors = {};
  if (!fullName.trim()) errors.fullName = 'Введите имя';
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = 'Введите корректный email';
  if (password.length < 8) errors.password = 'Пароль должен содержать минимум 8 символов';
  if (password !== confirmPassword) errors.confirmPassword = 'Пароли не совпадают';
  return { ok: Object.keys(errors).length === 0, errors };
}

export async function signUp({ fullName, email, password }) {
  const { data, error } = await requireClient().auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: fullName.trim() } }
  });
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await requireClient().auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await requireClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getProfile() {
  const session = await getSession();
  if (!session?.user) return null;
  const { data, error } = await requireClient()
    .from('profiles')
    .select('id,email,full_name,role,created_at')
    .eq('id', session.user.id)
    .single();
  if (error) throw error;
  return data;
}

export function onAuthStateChange(callback) {
  return requireClient().auth.onAuthStateChange(callback);
}
