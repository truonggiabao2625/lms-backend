import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/index.js';
import prisma from '../../src/lib/prisma.js';

const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });
};

describe('Integration Test: POST /api/instructor/courses', () => {
  let instructorToken;
  let studentToken;
  let testInstructor;
  let testStudent;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: ['instructor_test@test.com', 'student_test@test.com'] } },
    });

    testInstructor = await prisma.user.create({
      data: {
        name: 'Giang vien Test',
        email: 'instructor_test@test.com',
        password: 'hashedpassword',
        role: 'INSTRUCTOR',
      },
    });

    testStudent = await prisma.user.create({
      data: {
        name: 'Hoc vien Test',
        email: 'student_test@test.com',
        password: 'hashedpassword',
        role: 'STUDENT',
      },
    });

    instructorToken = generateToken(testInstructor.id, testInstructor.role);
    studentToken = generateToken(testStudent.id, testStudent.role);
  });

  afterAll(async () => {
    const userIds = [testInstructor?.id, testStudent?.id].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
    await prisma.$disconnect();
  });

  it('1. Nen tra ve 401 neu request khong co Token', async () => {
    const res = await request(app).post('/api/instructor/courses').send({ title: 'Khoa hoc khong phep' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('message');
  });

  it('2. Nen tra ve 403 neu User la Student', async () => {
    const res = await request(app)
      .post('/api/instructor/courses')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ title: 'Khoa hoc cua hoc vien' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/INSTRUCTOR|ADMIN/i);
  });

  it('3. Nen tao thanh cong khoa hoc voi thong tin day du', async () => {
    const payload = {
      title: 'Khoa hoc Jest va Supertest',
      description: 'Hoc cach viet integration test chuan xac',
      price: 500000,
    };

    const res = await request(app)
      .post('/api/instructor/courses')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.title).toBe(payload.title);
    expect(res.body.price).toBe(payload.price);
    expect(res.body.isPublished).toBe(false);
    expect(res.body.instructorId).toBe(testInstructor.id);

    const savedCourse = await prisma.course.findUnique({
      where: { id: res.body.id },
    });
    expect(savedCourse).toBeTruthy();
    expect(savedCourse.title).toBe(payload.title);
  });

  it('4. Nen gan gia tri mac dinh neu bo trong cac truong khong bat buoc', async () => {
    const res = await request(app)
      .post('/api/instructor/courses')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Khoa hoc moi');
    expect(res.body.description).toBe('');
    expect(res.body.price).toBe(0);
    expect(res.body.isPublished).toBe(false);
  });
});
