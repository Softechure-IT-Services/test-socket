import mysql from "mysql2/promise";

/**
 * IMPORTANT:
 * dotenv should be loaded ONCE in server.js
 * Do NOT call dotenv.config() here anymore
 */

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "softech_chat",
  port: Number(process.env.DB_PORT) || 3306,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 10000,
});

/* Debug logs */
pool.on("connection", () => {
  console.log("🟢 MySQL pool connection created");
});

pool.on("error", (err) => {
  console.error("🔥 MySQL Pool Error:", err.code, err.message);
});

/**
 * Compatibility wrapper:
 * - Callback style:
 *   db.query(sql, params, (err, rows) => {})
 *
 * - Promise style:
 *   const [rows] = await db.query(sql, params)
 */
function query(sql, params, cb) {
  if (typeof params === "function") {
    cb = params;
    params = [];
  }

  const promise = pool.query(sql, params);

  if (typeof cb === "function") {
    promise
      .then(([rows]) => cb(null, rows))
      .catch((err) => cb(err));
    return;
  }

  return promise;
}

const db = {
  pool,
  query,
};

export default db;




// // require("dotenv").config();
// // const mysql = require("mysql2/promise");

// import mysql from "mysql2/promise";

// const pool = mysql.createPool({
//   host: process.env.DB_HOST || "localhost",
//   user: process.env.DB_USER || "root",
//   password: process.env.DB_PASS || "",
//   database: process.env.DB_NAME || "softech_chat",
//   port: Number(process.env.DB_PORT) || 3306,

//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0,

//   enableKeepAlive: true,
//   keepAliveInitialDelay: 0,
//   connectTimeout: 10000,
// });

// // Debug logs
// pool.on("connection", () => {
//   console.log("🟢 MySQL pool connection created");
// });

// pool.on("error", (err) => {
//   console.error("🔥 MySQL Pool Error:", err.code, err.message);
// });

// // Compatibility wrapper: support both callback-style and promise-style usage
// // - Callback: db.query(sql, params, (err, rows) => {})
// // - Promise:  db.query(sql, params).then(([rows, fields]) => {})
// function query(sql, params, cb) {
//   if (typeof params === "function") {
//     cb = params;
//     params = [];
//   }

//   const p = pool.query(sql, params);

//   if (typeof cb === "function") {
//     p.then(([rows]) => cb(null, rows)).catch((err) => cb(err));
//     return;
//   }

//   return p;
// }

// // module.exports = {
// //   pool,
// //   query,
// // };


// const db = {
//   pool,
//   query,
// };

// export default db;
