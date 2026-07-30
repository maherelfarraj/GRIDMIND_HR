// Centralized fetch with credentials
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, { ...init, credentials: 'include' });
  if (res.status === 401) {
    // Clear any stored user and redirect to login
    localStorage.removeItem('hrms-session');
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login';
    }
  }
  return res;
}
