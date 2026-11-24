'use strict';

// Vercel serverless entrypoint: /api/* and the /uploads rewrite are handled by
// this function. Keeping the path shape (api/[...path]) means Express receives
// the original URL, so existing routes work unchanged.
const { app } = require('../server/app');

module.exports = app;
