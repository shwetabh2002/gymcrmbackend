import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../users/entities/user.entity';
import { Role } from '../../common/enums/role.enum';

export async function seedAdminUser(dataSource: DataSource) {
  const userRepository = dataSource.getRepository(User);

  // Check if admin already exists
  const existingAdmin = await userRepository.findOne({
    where: { email: 'admin@backendgym.com' },
  });

  if (existingAdmin) {
    console.log('Admin user already exists');
    return;
  }

  // Create admin user
  const hashedPassword = await bcrypt.hash('Admin@123', 10);

  const admin = userRepository.create({
    email: 'admin@backendgym.com',
    password: hashedPassword,
    name: 'Admin User',
    role: Role.ADMIN,
    isActive: true,
  });

  await userRepository.save(admin);

  console.log('Admin user created successfully');
  console.log('Email: admin@backendgym.com');
  console.log('Password: Admin@123');
}
