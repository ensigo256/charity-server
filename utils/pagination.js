const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function getPagination(req, options = {}) {
  const defaultLimit = Math.min(
    Math.max(Number(options.defaultLimit) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const pageValue = Number.parseInt(req.query.page, 10);
  const limitValue = Number.parseInt(req.query.limit, 10);
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : DEFAULT_PAGE;
  const limit = Number.isInteger(limitValue) && limitValue > 0
    ? Math.min(limitValue, MAX_LIMIT)
    : defaultLimit;

  return { page, limit, skip: (page - 1) * limit };
}

function setPaginationHeaders(res, { page, limit, total }) {
  const pageCount = total === 0 ? 0 : Math.ceil(total / limit);
  res.set({
    "X-Page": String(page),
    "X-Page-Size": String(limit),
    "X-Total-Count": String(total),
    "X-Page-Count": String(pageCount),
    "Access-Control-Expose-Headers": "X-Page, X-Page-Size, X-Total-Count, X-Page-Count",
  });
}

module.exports = { getPagination, setPaginationHeaders, MAX_LIMIT };
