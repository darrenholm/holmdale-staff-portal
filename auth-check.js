// Auth Check Script - Include at top of every protected page
// Usage: <script src="auth-check.js"></script>
(function() {
    const API = 'https://rodeo-fresh-production-7348.up.railway.app/api';
    
    function checkAuth() {
        const token = localStorage.getItem('auth_token');
        const staffName = localStorage.getItem('staff_name');
        
        if (!token) {
            window.location.href = 'login.html';
            return;
        }
        
        // Decode JWT to check expiration (without server call)
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < now) {
                // Token expired
                clearAuth();
                window.location.href = 'login.html';
                return;
            }
        } catch(e) {
            // Invalid token format
            clearAuth();
            window.location.href = 'login.html';
            return;
        }
        
        // Token valid - display staff name if element exists
        const staffNameElement = document.getElementById('currentStaffName');
        if (staffNameElement && staffName) {
            staffNameElement.textContent = staffName;
        }
    }
    
    function clearAuth() {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('staff_name');
        localStorage.removeItem('staff_id');
        localStorage.removeItem('staff_email');
        localStorage.removeItem('remember_me');
    }
    
    window.logout = function() {
        if (confirm('Are you sure you want to logout?')) {
            clearAuth();
            window.location.href = 'login.html';
        }
    };
    
    window.getCurrentStaff = function() {
        return {
            token: localStorage.getItem('auth_token'),
            name: localStorage.getItem('staff_name'),
            id: localStorage.getItem('staff_id'),
            email: localStorage.getItem('staff_email')
        };
    };
    
    checkAuth();
})();