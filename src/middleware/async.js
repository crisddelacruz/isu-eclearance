// Wraps an async route so any error goes to the error page.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);