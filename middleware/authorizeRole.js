require('dotenv').config();

function authorizeRole(...allowedRoles) {
  return (req, res, next) => {
    const userRole = (req.user?.role || '').toLowerCase().trim();
    const normalizedAllowed = allowedRoles.map(r => r.toLowerCase().trim());

    if (!userRole || !normalizedAllowed.includes(userRole)) {
      return res.status(403).json({ message: "Access denied: Unauthorized role" });
    }

    next();
  };
}

module.exports = authorizeRole;


