import 'dotenv/config';
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
const prisma = new PrismaClient();
async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@oes.local';
  const studentEmail = process.env.SEED_STUDENT_EMAIL || 'student@oes.local';
  const facultyEmail = process.env.SEED_FACULTY_EMAIL || 'faculty@oes.local';
  const devPassword = process.env.SEED_DEV_PASSWORD || 'ChangeThis123!';
  const passwordHash = await argon2.hash(devPassword, { type: argon2.argon2id });
  const admin = await prisma.user.upsert({ where: { email: adminEmail }, update: {}, create: { email: adminEmail, name: 'OES Administrator', passwordHash, role: 'ADMIN', status: 'ACTIVE', emailVerifiedAt: new Date() } });
  const student = await prisma.user.upsert({ where: { email: studentEmail }, update: {}, create: { email: studentEmail, name: 'Demo Student', passwordHash, role: 'STUDENT', status: 'ACTIVE', emailVerifiedAt: new Date(), studentProfile: { create: { studentCode: 'DEMO-STUDENT' } } } });
  const faculty = await prisma.user.upsert({ where: { email: facultyEmail }, update: {}, create: { email: facultyEmail, name: 'Demo Faculty', passwordHash, role: 'FACULTY', status: 'ACTIVE', emailVerifiedAt: new Date(), facultyProfile: { create: { employeeCode: 'DEMO-FACULTY', verificationStatus: 'APPROVED' } } } });
  const existing = await prisma.exam.findFirst({ where: { title: 'Introduction to Computing (Demo)', createdById: faculty.id } });
  if (!existing) {
    const opensAt = new Date(Date.now() - 60_000);
    const closesAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    await prisma.exam.create({ data: { title: 'Introduction to Computing (Demo)', subject: 'Computer Engineering', instructions: 'Read every question carefully. Your deadline is controlled by the server. Do not refresh repeatedly.', status: 'PUBLISHED', durationMinutes: 30, opensAt, closesAt, maxMarks: 10, passMarks: 4, createdById: faculty.id, questions: { create: [
      { prompt: 'Which data structure follows FIFO order?', type: 'SINGLE_CHOICE', marks: 2, position: 1, options: { create: [{ text: 'Stack', isCorrect: false, position: 1 }, { text: 'Queue', isCorrect: true, position: 2 }, { text: 'Tree', isCorrect: false, position: 3 }] } },
      { prompt: 'Which of these are programming languages? Select all that apply.', type: 'MULTIPLE_SELECT', marks: 3, position: 2, options: { create: [{ text: 'TypeScript', isCorrect: true, position: 1 }, { text: 'HTML', isCorrect: false, position: 2 }, { text: 'Python', isCorrect: true, position: 3 }] } },
      { prompt: 'Explain one benefit of database transactions.', type: 'DESCRIPTIVE', marks: 5, position: 3 }
    ] } } });
  }
  console.log(`Seed complete. Admin: ${admin.email}; student: ${student.email}; faculty: ${faculty.email}. Development password is set by SEED_DEV_PASSWORD or the documented default.`);
}
main().finally(() => prisma.$disconnect());
