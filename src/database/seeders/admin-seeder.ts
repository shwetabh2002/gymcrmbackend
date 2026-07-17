import { model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { Role } from '../../common/enums/role.enum';
import { UserType } from '../../common/enums/user-type.enum';

export async function seedAdminUser() {
  const UserModel = model<User>('User', UserSchema);

  // Read seed credentials from env.
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.error(
      'Cannot seed admin: set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in the environment.',
    );
    return;
  }

  // Check if admin already exists
  const existingAdmin = await UserModel.findOne({ email: adminEmail });

  if (existingAdmin) {
    console.log('Admin user already exists');
    return;
  }

  // Create admin user
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const admin = new UserModel({
    email: adminEmail,
    password: hashedPassword,
    name: 'Admin User',
    role: Role.ADMIN,
    userType: UserType.ADMIN,
  });

  await admin.save();

  // Do not log the password.
  console.log(`Admin user created successfully for ${adminEmail}`);
  console.log('Log in with the SEED_ADMIN_PASSWORD you configured, then change it.');
}
