const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function addAuthFields() {
  try {
    console.log('Adding authentication fields to staff table...');
    
    // Add password_hash column
    await pool.query(`
      ALTER TABLE staff 
      ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)
    `);
    
    console.log('✅ password_hash column added');
    
    // Add last_login column
    await pool.query(`
      ALTER TABLE staff 
      ADD COLUMN IF NOT EXISTS last_login TIMESTAMP
    `);
    
    console.log('✅ last_login column added');
    
    console.log('🎉 AUTHENTICATION FIELDS READY!');
    console.log('');
    console.log('Default password for all staff: rodeo2026');
    console.log('Staff can login with their email and this password.');
    console.log('They can change their password after first login.');
    
    await pool.end();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error adding auth fields:', error);
    process.exit(1);
  }
}

addAuthFields();
