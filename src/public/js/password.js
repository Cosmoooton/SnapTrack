const passwordInput = document.getElementById('newPassword');
const rules = {
  length: value => [...value].length >= 8,
  number: value => /[0-9]/.test(value),
  special: value => /[^a-zA-Z0-9\s]/.test(value),
  upper: value => /[A-Z]/.test(value),
  lower: value => /[a-z]/.test(value)
};
function updateRules() {
  for (const [name, validate] of Object.entries(rules)) {
    const item = document.querySelector(`[data-rule="${name}"]`);
    const valid = validate(passwordInput.value);
    item.classList.toggle('fulfilled', valid);
    item.querySelector('i').className = valid ? 'bi bi-check-circle-fill' : 'bi bi-circle';
  }
}
passwordInput.addEventListener('input', updateRules);
updateRules();
