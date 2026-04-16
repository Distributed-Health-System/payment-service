const protect = (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];

  if (!userId || !userRole) {
    const err = new Error('Missing auth headers - request not coming through gateway');
    err.statusCode = 401;
    return next(err);
  }

  req.user = {
    id: userId,
    role: userRole,
  };

  next();
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      const err = new Error(`Role '${req.user.role}' is not authorized`);
      err.statusCode = 403;
      return next(err);
    }
    next();
  };
};

module.exports = { protect, authorizeRoles };