// === AUTHENTICATION ===

// Error messages in Indonesian
var AUTH_ERRORS = {
    'auth/email-already-in-use': 'Email sudah terdaftar. Gunakan email lain atau masuk.',
    'auth/invalid-email': 'Format email tidak valid.',
    'auth/user-not-found': 'Akun tidak ditemukan. Periksa email Anda.',
    'auth/wrong-password': 'Kata sandi salah.',
    'auth/invalid-credential': 'Email atau kata sandi salah.',
    'auth/weak-password': 'Kata sandi minimal 6 karakter.',
    'auth/too-many-requests': 'Terlalu banyak percobaan. Silakan coba lagi nanti.',
    'auth/network-request-failed': 'Gagal terhubung. Periksa koneksi internet Anda.'
};

function getAuthErrorMessage(error) {
    return AUTH_ERRORS[error.code] || error.message || 'Terjadi kesalahan. Coba lagi.';
}

// DOM refs
var authSection = document.getElementById('auth-section');
var appContent = document.getElementById('app-content');
var loginForm = document.getElementById('login-form');
var signupForm = document.getElementById('signup-form');
var loginError = document.getElementById('login-error');
var signupError = document.getElementById('signup-error');
var rememberMe = document.getElementById('remember-me');
var navUsername = document.getElementById('nav-username');

// Toggle between login and signup forms
document.getElementById('show-signup').addEventListener('click', function () {
    loginForm.style.display = 'none';
    signupForm.style.display = 'block';
    loginError.style.display = 'none';
    signupError.style.display = 'none';
});

document.getElementById('show-login').addEventListener('click', function () {
    signupForm.style.display = 'none';
    loginForm.style.display = 'block';
    loginError.style.display = 'none';
    signupError.style.display = 'none';
});

// Signup handler
signupForm.addEventListener('submit', function (e) {
    e.preventDefault();

    var username = document.getElementById('signup-username').value.trim();
    var email = document.getElementById('signup-email').value.trim();
    var password = document.getElementById('signup-password').value;

    if (!username || !email || !password) return;

    signupError.style.display = 'none';
    var submitBtn = signupForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Mendaftarkan...';

    auth.createUserWithEmailAndPassword(email, password)
        .then(function (result) {
            var user = result.user;

            // Create profile document
            return db.collection('users').doc(user.uid).collection('profile').doc('data').set({
                username: username,
                email: email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(function () {
                // Create default settings document
                return db.collection('users').doc(user.uid).collection('settings').doc('main').set({
                    paydayStart: 1,
                    geminiApiKey: 'AIzaSyD6Ihu6g78yikRmSw63igCWV_5RpcA_0Ks'
                });
            });
        })
        .catch(function (err) {
            signupError.textContent = getAuthErrorMessage(err);
            signupError.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Daftar';
        });
});

// Login handler
loginForm.addEventListener('submit', function (e) {
    e.preventDefault();

    var email = document.getElementById('login-email').value.trim();
    var password = document.getElementById('login-password').value;

    if (!email || !password) return;

    loginError.style.display = 'none';
    var submitBtn = loginForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Masuk...';

    // Set persistence based on "Ingat Saya" checkbox
    var persistence = rememberMe.checked
        ? firebase.auth.Auth.Persistence.LOCAL
        : firebase.auth.Auth.Persistence.SESSION;

    auth.setPersistence(persistence).then(function () {
        return auth.signInWithEmailAndPassword(email, password);
    }).catch(function (err) {
        loginError.textContent = getAuthErrorMessage(err);
        loginError.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Masuk';
    });
});

// Logout handler
document.getElementById('btn-logout').addEventListener('click', function () {
    auth.signOut();
});

// Load user profile (display name in navbar)
function loadUserProfile(userUid) {
    db.collection('users').doc(userUid).collection('profile').doc('data').get()
        .then(function (doc) {
            if (doc.exists) {
                navUsername.textContent = doc.data().username || '';
            }
        })
        .catch(function () {
            navUsername.textContent = auth.currentUser ? auth.currentUser.email : '';
        });
}

// Auth state observer — central routing
auth.onAuthStateChanged(function (user) {
    if (user) {
        // Logged in: show app, hide auth
        authSection.style.display = 'none';
        appContent.style.display = 'block';
        loadUserProfile(user.uid);

        // Initialize data listeners (defined in app.js)
        if (typeof initDataListeners === 'function') {
            initDataListeners(user.uid);
        }
    } else {
        // Logged out: show auth, hide app
        authSection.style.display = 'flex';
        appContent.style.display = 'none';

        // Cleanup data listeners
        if (typeof cleanupDataListeners === 'function') {
            cleanupDataListeners();
        }

        // Reset forms
        loginForm.reset();
        signupForm.reset();
        loginError.style.display = 'none';
        signupError.style.display = 'none';
        signupForm.style.display = 'none';
        loginForm.style.display = 'block';

        // Reset submit buttons
        loginForm.querySelector('button[type="submit"]').disabled = false;
        loginForm.querySelector('button[type="submit"]').textContent = 'Masuk';
        signupForm.querySelector('button[type="submit"]').disabled = false;
        signupForm.querySelector('button[type="submit"]').textContent = 'Daftar';
    }
});

// === CONNECTION STATUS ===
function updateOnlineStatus() {
    var banner = document.getElementById('offline-banner');
    if (!banner) return;
    banner.style.display = navigator.onLine ? 'none' : 'block';
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
