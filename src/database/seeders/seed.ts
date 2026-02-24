import { connect, connection } from 'mongoose';
import { config } from 'dotenv';
import { seedAdminUser } from './admin-seeder';

// Load environment variables
config();

async function runSeeders() {
  try {
    // Connect to MongoDB
    await connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/backendgym');
    console.log('MongoDB connection established!');

    await seedAdminUser();

    console.log('Seeding completed successfully');
    await connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error during seeding:', error);
    await connection.close();
    process.exit(1);
  }
}

runSeeders();
