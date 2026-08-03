import { model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { Role } from '../../common/enums/role.enum';
import { UserType } from '../../common/enums/user-type.enum';

/**
 * Seeds platform SUPER_ADMIN (no company).
 * Set SEED_SUPER_ADMIN_EMAIL + SEED_SUPER_ADMIN_PASSWORD.
 */
export async function seedAdminUser() {
  const UserModel = model<User>('User', UserSchema);

  const adminEmail =
    process.env.SEED_SUPER_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
  const adminPassword =
    process.env.SEED_SUPER_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.error(
      'Cannot seed: set SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD',
    );
    return;
  }

  const existing = await UserModel.findOne({ email: adminEmail });
  if (existing) {
    console.log('Platform admin already exists');
    return;
  }

  const hashedPassword = await bcrypt.hash(adminPassword, 10);
  await new UserModel({
    email: adminEmail,
    password: hashedPassword,
    name: 'Platform Admin',
    role: Role.SUPER_ADMIN,
    userType: UserType.ADMIN,
    companyId: null,
    activeCompanyId: null,
  }).save();

  console.log(`SUPER_ADMIN created for ${adminEmail}`);
}
