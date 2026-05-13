/**
 * Global Error Handler Middleware
 * Đặt SAU tất cả routes trong index.js
 */

// 404 handler — Route không tồn tại
export const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    status: 'error',
    message: `Route ${req.method} ${req.originalUrl} không tồn tại`,
  });
};

// Global error handler — Xử lý mọi lỗi chưa được catch
export const globalErrorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err);

  // Prisma known errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      status: 'error',
      message: 'Dữ liệu đã tồn tại (trùng unique constraint)',
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      status: 'error',
      message: 'Không tìm thấy bản ghi',
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      status: 'error',
      message: 'Token không hợp lệ',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      status: 'error',
      message: 'Token đã hết hạn',
    });
  }

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      status: 'error',
      message: 'File quá lớn',
    });
  }

  // Default: Internal Server Error
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    status: 'error',
    message: process.env.NODE_ENV === 'production'
      ? 'Lỗi server nội bộ'
      : err.message || 'Lỗi server nội bộ',
  });
};
