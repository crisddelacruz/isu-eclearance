// One-time messages (e.g. "Account created") that survive a redirect.
// They live in the signed cookie, so keep them short.
module.exports = function flash(req, res, next) {
  req.flash = (type, msg) => {
    if (!req.session.flash) req.session.flash = [];
    if (req.session.flash.length < 4) req.session.flash.push({ type, msg: String(msg).slice(0, 300) });
  };
  res.locals.flash = req.session.flash || [];
  if (req.session.flash) delete req.session.flash;
  next();
};