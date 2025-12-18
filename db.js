require("dotenv").config(); 

const mysql = require("mysql2");
console.log("ENV:", process.env.DB_USER, process.env.DB_PASS);

const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "softech_chat",
});

db.connect((err) => {
  if (err) {
    console.log("DB Connection Error:", err);
  } else {
    console.log("MySQL Connected!");
  }
});

module.exports = db;
