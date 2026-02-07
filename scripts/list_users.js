const db = require('../config/database');

(async () => {
  try {
    const res = await db.query('SELECT id, email, full_name, role, is_active, created_at FROM users ORDER BY id');
    console.log('Users in DB:');
    console.table(res.rows);
    process.exit(0);
  } catch (err) {
    console.error('Error listing users:', err);
    process.exit(1);
  }
})();
