const TagakFields = (() => {
  const branchError = 'Branch code must be numbers only (max 7 digits).';
  const nameError = 'Only letters are allowed in name fields.';
  const nicknameError = 'Nickname is required before approving this order.';
  const validCode = value => typeof value === 'string' && value.length >= 1 && value.length <= 7 && !/[^0-9]/.test(value);
  const validName = value => typeof value === 'string' && /^[\p{L} '-]*$/u.test(value);

  const phoneError = 'Enter an 11-digit Philippine mobile number starting with 09.';
  const duplicatePhoneError = 'This phone number is already registered to another account.';
  const validPhone = value => typeof value === 'string' && value.length === 11 && /^09[0-9]{9}$/.test(value);

  function passwordError(password) {
    const missing = [];
    if (Array.from(password).length < 8) missing.push('at least 8 characters');
    if (!/[A-Z]/.test(password)) missing.push('an uppercase letter');
    if (!/[a-z]/.test(password)) missing.push('a lowercase letter');
    if (!/[0-9]/.test(password)) missing.push('a number');
    if (!/[\p{P}\p{S}]/u.test(password)) missing.push('a special character');
    if (missing.length) return 'Password must contain ' + missing.join(', ') + '.';
    return new TextEncoder().encode(password).length > 72 ? 'Password must fit within 72 UTF-8 bytes' : '';
  }

  function bind(input, error, accepts, message, update, active = () => true) {
    let previous = input.value;
    function show(invalid) {
      input.setCustomValidity(invalid ? message : '');
      input.setAttribute('aria-invalid', String(invalid));
      error.textContent = invalid ? message : '';
      error.classList.toggle('hidden', !invalid);
      update();
    }
    function checkInsertion(event, text) {
      if (!active() || text == null) return;
      const next = input.value.slice(0, input.selectionStart) + text + input.value.slice(input.selectionEnd);
      if (!accepts(next)) {
        event.preventDefault();
        show(true);
      }
    }
    input.addEventListener('paste', event => checkInsertion(event, event.clipboardData?.getData('text')));
    input.addEventListener('beforeinput', event => checkInsertion(event, event.data));
    input.addEventListener('input', () => {
      const invalid = active() && input.value !== '' && !accepts(input.value);
      if (invalid) input.value = previous;
      else previous = input.value;
      show(invalid);
    });
    return () => { previous = input.value; show(active() && !!previous && !accepts(previous)); };
  }
  return { validPhone, phoneError, duplicatePhoneError, passwordError, validCode, validName, branchError, nameError, nicknameError, bind };
})();
if (typeof module !== 'undefined') module.exports = TagakFields;
