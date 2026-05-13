import prisma from '../src/lib/prisma.js';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('Seeding users...');

  // Hash password
  const saltRounds = 10;
  const adminPassword = await bcrypt.hash('123456', saltRounds);
  const studentPassword = await bcrypt.hash('123456', saltRounds);
  const instructorPassword = await bcrypt.hash('123456', saltRounds);

  // Create Admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@gmail.com' },
    update: { role: 'ADMIN' },
    create: {
      email: 'admin@gmail.com',
      name: 'Admin User',
      password: adminPassword,
      role: 'ADMIN',
    },
  });
  console.log('Admin created:', admin.email);

  // Create Student
  const student = await prisma.user.upsert({
    where: { email: 'student@gmail.com' },
    update: { role: 'STUDENT' },
    create: {
      email: 'student@gmail.com',
      name: 'Student User',
      password: studentPassword,
      role: 'STUDENT',
    },
  });
  console.log('Student created:', student.email);

  // Create Instructor
  const instructor = await prisma.user.upsert({
    where: { email: 'instructor@gmail.com' },
    update: { role: 'INSTRUCTOR' },
    create: {
      email: 'instructor@gmail.com',
      name: 'Instructor User',
      password: instructorPassword,
      role: 'INSTRUCTOR',
    },
  });
  console.log('Instructor created:', instructor.email);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('Seeding completed successfully.');
  })
  .catch(async (e) => {
    console.error('Error seeding data:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
