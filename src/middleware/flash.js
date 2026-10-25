// One-time messages (e.g. "Account created") that survive a redirect.
module.exports = function flash(req, res, next) {
  req.flash = (type, msg) => {
    if (!req.session.flash) req.session.flash = [];
    req.session.flash.push({ type, msg });
  };
  res.locals.flash = req.session.flash || [];
  delete req.session.flash;
  next();
};