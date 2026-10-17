export async function loadPublicConfig() {
  const response = await fetch('/api/config', { cache: 'no-store' });
  if (!response.ok) throw new Error('Не удалось получить конфигурацию приложения.');
  return response.json();
}
