require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcrypt');
const User = require('../src/models/user');
const { db, ready } = require('../src/config/database');
const { passwordIsValid } = require('../src/utils/password');

// Das Passwort wird über stdin eingelesen und nicht als Prozessargument übergeben.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
function question(prompt) { return new Promise(resolve => rl.question(prompt, resolve)); }
async function main() {
  await ready;
  const username = (await question('Benutzername: ')).trim();
  if (!username || username.length > 64) throw new Error('Der Benutzername muss 1 bis 64 Zeichen lang sein.');
  console.log('Hinweis: Die Passworteingabe ist auf diesem Terminal sichtbar.');
  const password = await question('Passwort: ');
  if (!passwordIsValid(password)) throw new Error('Das Passwort benötigt mindestens 8 Zeichen, eine Zahl, ein Sonderzeichen, einen Groß- und einen Kleinbuchstaben und darf höchstens 72 UTF-8-Bytes lang sein.');
  const confirmation = await question('Passwort wiederholen: ');
  if (password !== confirmation) throw new Error('Die Passwörter stimmen nicht überein.');
  await User.create(username, await bcrypt.hash(password, 12));
  console.log('Benutzer wurde angelegt.');
}
main().catch(error => { console.error('Benutzer konnte nicht angelegt werden:', error.message); process.exitCode = 1; })
  .finally(() => { rl.close(); db.close(); });
