import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { seedAdminUser } from './admin-seeder';

// Load environment variables
config();

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
  synchronize: false,
});

async function runSeeders() {
  try {
    await AppDataSource.initialize();
    console.log('Data Source has been initialized!');

    await seedAdminUser(AppDataSource);

    console.log('Seeding completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error during seeding:', error);
    process.exit(1);
  }
}

runSeeders();
