/**
 * utils/seed.js
 *
 * Seeder for the default TickApp admin account.
 * Run standalone:  node utils/seed.js
 * Called on start: imported and invoked from server.js
 */

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { connectDB } from '../config/db.js';

const ADMIN_EMAIL     = 'admin@tickapp.com';
const ADMIN_PASSWORD  = 'Admin@1234';
const ADMIN_FIRST     = 'Admin';
const ADMIN_LAST      = 'TickApp';
const ADMIN_PHONE     = '+10000000000';

/**
 * Seed the default admin user.
 * Safe to call multiple times — only creates the user if no admin exists.
 */
export const seedAdmin = async () => {
  try {
    const existingAdmin = await User.findOne({
      $or: [
        { role: 'ADMIN'       },
        { role: 'SUPER_ADMIN' },
        { email: ADMIN_EMAIL  },
      ],
    });

    if (existingAdmin) {
      console.log('[Seed] Admin user already exists — skipping seed.');
      return;
    }

    const salt         = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, salt);

    const admin = await User.create({
      firstName:    ADMIN_FIRST,
      lastName:     ADMIN_LAST,
      email:        ADMIN_EMAIL,
      phone:        ADMIN_PHONE,
      passwordHash,
      role:         'ADMIN',
      status:       'APPROVED',
      emailVerified: true,
      avatar: {
        url:      `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(ADMIN_FIRST + ' ' + ADMIN_LAST)}`,
        publicId: '',
      },
    });

    console.log(`\n✅ [Seed] Default admin created:`);
    console.log(`   Email:    ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);
    console.log(`   ID:       ${admin._id}\n`);
  } catch (error) {
    // Duplicate key: admin already exists in a concurrent start-up
    if (error.code === 11000) {
      console.log('[Seed] Admin already exists (duplicate key) — skipping.');
      return;
    }
    console.error('[Seed Error]', error.message);
  }
};

// ── Standalone execution ──────────────────────────────────────────────────────
// `node utils/seed.js`
const isMain = process.argv[1]?.endsWith('seed.js');

if (isMain) {
  (async () => {
    try {
      await connectDB();
      await seedAdmin();
      console.log('[Seed] Done.');
      process.exit(0);
    } catch (err) {
      console.error('[Seed] Fatal error:', err.message);
      process.exit(1);
    }
  })();
}
