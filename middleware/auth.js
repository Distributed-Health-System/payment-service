const protect = (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];
  const serviceToken = req.headers["x-service-token"];
  const serviceName = req.headers["x-service-name"] || "internal-service";

  if (serviceToken) {
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;

    if (!expectedToken || serviceToken !== expectedToken) {
      const err = new Error("Invalid internal service token");
      err.statusCode = 401;
      return next(err);
    }

    req.user = {
      id: serviceName,
      role: "service",
    };

    return next();
  }

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
    if (req.user.role === "service") {
      return next();
    }

    if (!roles.includes(req.user.role)) {
      const err = new Error(`Role '${req.user.role}' is not authorized`);
      err.statusCode = 403;
      return next(err);
    }
    next();
  };
};

module.exports = { protect, authorizeRoles };