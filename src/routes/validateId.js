// ESPN team and event ids are numeric; reject anything else before it
// reaches the upstream API or SQLite.
function validateId(req, res, next, id) {
  if (!/^\d{1,12}$/.test(id)) {
    return res.status(400).json({ error: 'bad_request', message: `invalid id: ${id}` });
  }
  return next();
}

module.exports = validateId;
