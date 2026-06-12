// auth.js - Admin Authentication System for Olimpiade Annur

// Admin credentials (in production, this should be server-side)
const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: 'admin123'
};

const SESSION_KEY = 'admin_session_token';
const SESSION_EXPIRY_KEY = 'admin_session_expiry';
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate a simple session token
 */
function generateSessionToken() {
  return 'admin_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
}

/**
 * Login admin user
 */
function loginAdmin(username, password) {
  // Verify credentials
  if (username !== ADMIN_CREDENTIALS.username || password !== ADMIN_CREDENTIALS.password) {
    return false;
  }

  // Create session
  const token = generateSessionToken();
  const expiryTime = Date.now() + SESSION_DURATION;

  localStorage.setItem(SESSION_KEY, token);
  localStorage.setItem(SESSION_EXPIRY_KEY, expiryTime.toString());
  localStorage.setItem('admin_login_time', new Date().toLocaleString('id-ID'));

  return true;
}

/**
 * Logout admin user
 */
function logoutAdmin() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_EXPIRY_KEY);
  localStorage.removeItem('admin_login_time');
  localStorage.removeItem('admin_remembered_username');
}

/**
 * Check if admin is logged in
 */
function isAdminLoggedIn() {
  const token = localStorage.getItem(SESSION_KEY);
  const expiry = localStorage.getItem(SESSION_EXPIRY_KEY);

  if (!token || !expiry) {
    return false;
  }

  // Check if session has expired
  if (Date.now() > parseInt(expiry)) {
    logoutAdmin();
    return false;
  }

  return true;
}

/**
 * Get session info
 */
function getSessionInfo() {
  if (!isAdminLoggedIn()) {
    return null;
  }

  return {
    loginTime: localStorage.getItem('admin_login_time'),
    expiryTime: new Date(parseInt(localStorage.getItem(SESSION_EXPIRY_KEY))).toLocaleString('id-ID')
  };
}

/**
 * Protect a page - redirect to login if not authenticated
 */
function protectAdminPage() {
  if (!isAdminLoggedIn()) {
    window.location.href = 'admin-login.html';
  }
}

/**
 * Auto-logout on browser close (optional)
 */
window.addEventListener('beforeunload', () => {
  // Optional: Clear session on browser close
  // Uncomment the line below if you want auto-logout on browser close
  // logoutAdmin();
});

/**
 * Check session validity periodically
 */
setInterval(() => {
  if (!isAdminLoggedIn()) {
    if (window.location.pathname.includes('admin.html')) {
      alert('Sesi Anda telah berakhir. Silakan login kembali.');
      logoutAdmin();
      window.location.href = 'admin-login.html';
    }
  }
}, 60000); // Check every minute
