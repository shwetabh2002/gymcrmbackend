import { model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { Role } from '../../common/enums/role.enum';

export async function seedAdminUser() {
  const UserModel = model<User>('User', UserSchema);

  // Check if admin already exists
  const existingAdmin = await UserModel.findOne({
    email: 'admin@backendgym.com',
  });

  if (existingAdmin) {
    console.log('Admin user already exists');
    return;
  }

  // Create admin user
  const hashedPassword = await bcrypt.hash('Admin@123', 10);

  const admin = new UserModel({
    email: 'admin@backendgym.com',
    password: hashedPassword,
    name: 'Admin User',
    role: Role.ADMIN,
    isActive: true,
  });

  await admin.save();

  console.log('Admin user created successfully');
  console.log('Email: admin@backendgym.com');
  console.log('Password: Admin@123');
}
