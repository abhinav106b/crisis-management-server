const bcrypt = require('bcrypt');
const db = require('../config/database');

const EMAIL = process.env.TEST_USER_EMAIL || 'test@example.com';
const PASSWORD = process.env.TEST_USER_PASSWORD || '12345';
const FULL_NAME = process.env.TEST_USER_FULLNAME || 'Test User';
const ROLE = process.env.TEST_USER_ROLE || 'dispatcher';

(async () => {
  try {
    // Check if user exists
    const existing = await db.query('SELECT id, email FROM users WHERE email = $1', [EMAIL]);
    if (existing.rows.length > 0) {
      console.log(`User ${EMAIL} already exists with id=${existing.rows[0].id}. Updating password and activating account.`);
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(PASSWORD, salt);
      await db.query('UPDATE users SET password_hash = $1, is_active = true, full_name = $2 WHERE email = $3', [passwordHash, FULL_NAME, EMAIL]);
      console.log('Password updated successfully.');
      process.exit(0);
    }

    // Create new user
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(PASSWORD, salt);

    const insertQuery = `
      INSERT INTO users (email, password_hash, full_name, role, is_active)
      VALUES ($1, $2, $3, $4, true)
      RETURNING id, email, full_name, role, is_active
    `;

    const result = await db.query(insertQuery, [EMAIL, passwordHash, FULL_NAME, ROLE]);
    console.log('Created test user:', result.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error('Error creating test user:', err);
    process.exit(1);
  }
})();
