class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Lets async controllers throw instead of calling next(err) by hand
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Postgres foreign key / check / unique violations become 400/409 instead of 500
  if (err.code === '23503' || err.code === '23514') return res.status(400).json({ error: err.detail || err.message });
  if (err.code === '23505') return res.status(409).json({ error: err.detail || err.message });
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
}

module.exports = { HttpError, asyncHandler, notFound, errorHandler };
