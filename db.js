require("dotenv").config(); 

const mysql = require("mysql2");
console.log("ENV:", process.env.DB_USER, process.env.DB_PASS);

const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "softech_chat",
  port: process.env.DB_PORT || 3306,
});

db.connect((err) => {
  if (err) {
    console.log("DB Connection Error:", err);
  } else {
    console.log("MySQL Connected!");
  }
});

module.exports = db;


// db.js
// require("dotenv").config();
// const mysql = require("mysql2/promise");

// const pool = mysql.createPool({
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASS,
//   database: process.env.DB_NAME,
//   port: Number(process.env.DB_PORT) || 3306,

//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0,

//   enableKeepAlive: true,
//   keepAliveInitialDelay: 0,
//   connectTimeout: 10000,
// });

// // Optional but VERY useful
// pool.on("connection", () => {
//   console.log("🟢 MySQL pool connection created");
// });

// pool.on("error", (err) => {
//   console.error("🔥 MySQL Pool Error:", err.code, err.message);
// });

// module.exports = pool;
