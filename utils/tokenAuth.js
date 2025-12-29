const db = require("../db");

function verifyOpaqueToken(token) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT id, name, email, avatar_url
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
        name: rows[0].name,
        email: rows[0].email,
        avatar_url: rows[0].avatar_url,
      });
    });
  });
}

module.exports = { verifyOpaqueToken };
