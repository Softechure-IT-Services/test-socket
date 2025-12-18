const db = require("../db");

function verifyOpaqueToken(token) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT id, email
      FROM users
      WHERE auth_token = ?
      LIMIT 1
    `;

    db.query(sql, [token], (err, rows) => {
      if (err || !rows.length) {
        return reject(new Error("Invalid token"));
      }

      resolve({
        id: rows[0].id,
        email: rows[0].email,
      });
    });
  });
}

module.exports = { verifyOpaqueToken };
