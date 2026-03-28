const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'holmdale_rodeo_secret_2026_change_in_production';

// POST /api/auth/staff-login - Staff member login
router.post('/staff-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    // Find staff by email
    const result = await pool.query(
      'SELECT * FROM staff WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const staff = result.rows[0];
    
    // Check if staff has a password set
    if (!staff.password_hash) {
      // First time login - set default password
      const defaultPassword = 'rodeo2026';
      const isMatch = password === defaultPassword;
      
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      
      // Hash and save the default password
      const hash = await bcrypt.hash(defaultPassword, 10);
      await pool.query(
        'UPDATE staff SET password_hash = $1 WHERE id = $2',
        [hash, staff.id]
      );
      
      staff.password_hash = hash;
      
    } else {
      // Verify password
      const isMatch = await bcrypt.compare(password, staff.password_hash);
      
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        id: staff.id, 
        email: staff.email,
        fullname: staff.fullname,
        type: 'staff'
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    // Update last login
    await pool.query(
      'UPDATE staff SET last_login = NOW() WHERE id = $1',
      [staff.id]
    );
    
    console.log(`✓ Staff login: ${staff.fullname} (${staff.email})`);
    
    res.json({
      success: true,
      token,
      staff: {
        id: staff.id,
        fullname: staff.fullname,
        email: staff.email,
        adult: staff.adult,
        smartserve: staff.smartserve
      }
    });
    
  } catch (error) {
    console.error('Staff login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/verify - Verify token is valid
router.get('/verify', authenticateToken, (req, res) => {
  res.json({ 
    valid: true, 
    staff: req.staff 
  });
});

// POST /api/auth/change-password - Change password
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    
    // Get current staff
    const result = await pool.query(
      'SELECT * FROM staff WHERE id = $1',
      [req.staff.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    
    const staff = result.rows[0];
    
    // Verify current password
    if (staff.password_hash) {
      const isMatch = await bcrypt.compare(currentPassword, staff.password_hash);
      if (!isMatch) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    } else {
      // First time - check default password
      if (currentPassword !== 'rodeo2026') {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }
    
    // Hash new password
    const hash = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await pool.query(
      'UPDATE staff SET password_hash = $1 WHERE id = $2',
      [hash, req.staff.id]
    );
    
    console.log(`✓ Password changed: ${staff.fullname}`);
    
    res.json({ success: true, message: 'Password changed successfully' });
    
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    
    req.staff = decoded;
    next();
  });
}

module.exports = router;
module.exports.authenticateToken = authenticateToken;
