const MenuInitials = {
  text(name) {
    const [first, second] = String(name ?? '').trim().split(/\s+/);
    if (!first) return '?';
    const letters = second ? [Array.from(first)[0], Array.from(second)[0]] : Array.from(first).slice(0, 2);
    return letters.join('').toUpperCase();
  },
  element(name, className) {
    const span = document.createElement('span');
    span.className = className;
    span.setAttribute('aria-hidden', 'true');
    span.textContent = this.text(name);
    return span;
  },
};
