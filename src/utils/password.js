function passwordIsValid(password) {
  return typeof password === 'string' && [...password].length >= 8 &&
    Buffer.byteLength(password, 'utf8') <= 72 && /[0-9]/.test(password) &&
    /[A-Z]/.test(password) && /[a-z]/.test(password) && /[^a-zA-Z0-9\s]/.test(password);
}

module.exports = { passwordIsValid };
