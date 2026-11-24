'use strict';

// Vercel's zero-config Express detection looks for an entrypoint named
// app.js / index.js / server.js at the project root that imports express and
// exports the application (or starts a listener).
const express = require('express'); // eslint-disable-line no-unused-vars
const { app } = require('./server/app');

module.exports = app;

// `node server.js` still works locally.
if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`SnackTime berjalan di http://0.0.0.0:${port}`);
  });
}
