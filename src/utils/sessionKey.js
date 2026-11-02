const crypto = require('crypto');
module.exports = sid => crypto.createHmac('sha256', process.env.SESSION_SECRET).update('revoked-session:').update(sid).digest('hex');
