import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';

/**
 * Canonical role values (mirrors Prisma Role enum).
 * Using a plain object so existing JS code can reference without TypeScript.
 */
export const Role = Object.freeze({
  STUDENT: 'STUDENT',
  INSTRUCTOR: 'INSTRUCTOR',
  ADMIN: 'ADMIN',
});

const extractBearerToken = (authorizationHeader) => {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
};

export const verifyToken = async (req, res, next) => {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    return res.status(401).json({ message: 'Khong tim thay token xac thuc hop le' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, role: true },
    });

    if (!user) {
      return res.status(401).json({ message: 'Phien dang nhap khong con hop le. Vui long dang nhap lai.' });
    }

    req.userId = user.id;
    req.userRole = user.role;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token khong hop le hoac da het han' });
  }
};

/**
 * Factory middleware — restricts access to the listed roles.
 *
 * Usage:
 *   router.get('/admin-only', verifyToken, authorizeRole([Role.ADMIN]), handler);
 *   router.get('/staff',      verifyToken, authorizeRole([Role.INSTRUCTOR, Role.ADMIN]), handler);
 */
export const authorizeRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({
        message: `Yeu cau mot trong cac quyen: ${roles.join(', ')}`,
      });
    }
    next();
  };
};

// ── Convenience aliases (backward-compatible) ──────────────────────────

export const isAdmin = authorizeRole([Role.ADMIN]);

export const isInstructor = authorizeRole([Role.INSTRUCTOR, Role.ADMIN]);
