const API = 'https://rodeo-fresh-production-7348.up.railway.app';

async function checkAuth() {
  const token = localStorage.getItem('rodeo_token');
  if (!token) {
    window.location.href = '/login.html';
    return null;
  }

  try {
    const res = await fetch(`${API}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.valid) {
      localStorage.removeItem('rodeo_token');
      window.location.href = '/login.html';
      return null;
    }
    return data.staff;
  } catch (e) {
    window.location.href = '/login.html';
    return null;
  }
}

function logout() {
  localStorage.removeItem('rodeo_token');
  window.location.href = '/login.html';
}

function getToken() {
  return localStorage.getItem('rodeo_token');
}
