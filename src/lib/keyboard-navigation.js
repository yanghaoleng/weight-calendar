const CONTROLS = 'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
const GROUPS = '.pin-keypad, .weight-keypad, .calendar-grid, [role="radiogroup"], [role="tablist"], .theme-options, .font-options';

export function isEditingText(target) {
  return target?.isContentEditable || Boolean(target?.closest?.('textarea, select, input:not([type="range"]):not([type="checkbox"]):not([type="radio"])'));
}

export function directionalIndex(rects, current, key) {
  const origin = rects[current];
  if (!origin) return -1;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
  let best = -1;
  let score = Infinity;
  rects.forEach((rect, index) => {
    const dx = rect.x - origin.x;
    const dy = rect.y - origin.y;
    const ahead = (horizontal ? dx : dy) * sign;
    const across = Math.abs(horizontal ? dy : dx);
    if (index === current || ahead < 2) return;
    const distance = ahead + across * 4;
    if (distance < score) { score = distance; best = index; }
  });
  return best;
}

function visible(element) {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert], [aria-hidden="true"]');
}

export function installKeyboardNavigation() {
  const controls = (root) => [...root.querySelectorAll(CONTROLS)].filter((item) => visible(item) && !item.matches(':disabled, [aria-disabled="true"]'));
  const topDialog = () => [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(visible).at(-1);
  const page = () => [...document.querySelectorAll('main')].filter(visible).at(-1) || document.body;
  let modal = null;
  let lastTrigger = null;
  const returnTargets = new Map();
  const rememberTrigger = (event) => {
    const trigger = event.target.closest?.('button, a[href]');
    if (trigger) lastTrigger = trigger;
  };
  function syncFocus() {
    const next = topDialog();
    if (next === modal) return;
    const previous = modal;
    modal = next;
    if (next) {
      if (!returnTargets.has(next)) {
        const active = document.activeElement;
        returnTargets.set(next, active === document.body || next.contains(active) ? lastTrigger : active);
      }
      next.tabIndex = -1;
      if (!next.contains(document.activeElement)) next.focus({ preventScroll: true });
    } else if (previous) {
      const target = returnTargets.get(previous);
      // Some pages recreate their action buttons when a modal mode closes.
      const restored = target?.isConnected ? target : controls(page()).find((item) => (
        target && item.tagName === target.tagName
        && item.textContent.trim() === target.textContent.trim()
        && item.getAttribute('aria-label') === target.getAttribute('aria-label')
      ));
      restored?.focus({ preventScroll: true });
      returnTargets.clear();
    }
  }
  const observer = new MutationObserver(syncFocus);
  observer.observe(document.body, { childList: true, subtree: true });
  syncFocus();
  const onKeyDown = (event) => {
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const dialog = topDialog();
    const root = dialog || page();
    const active = document.activeElement;
    const key = event.key;
    if (key === 'Escape') {
      if (event.repeat) return;
      // Never dismiss an underlying page while a dialog is busy or cannot close.
      const close = dialog
        ? dialog.querySelector('.close-button, [data-sfx="cancel"], [data-sfx="back"], #delete-success-confirm')
        : root.querySelector('header [data-sfx="back"]');
      if (close && !close.disabled) { event.preventDefault(); close.click(); }
      return;
    }
    if (key === 'Tab' && dialog) {
      const items = controls(dialog);
      const index = items.indexOf(active);
      if (!items.length) { event.preventDefault(); dialog.focus(); }
      else if (index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
        event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus();
      }
      return;
    }
    if (isEditingText(active) || active?.matches('input[type="range"]')) return;
    const keypad = root.querySelector('.pin-keypad, .weight-keypad');
    if (keypad && (/^\d$/.test(key) || key === 'Backspace' || key === '.' || key === 'Decimal')) {
      if ((key === '.' || key === 'Decimal') && !keypad.matches('.weight-keypad')) return;
      event.preventDefault();
      const suffix = key === 'Backspace' ? 'delete' : key === '.' || key === 'Decimal' ? 'decimal' : key;
      const button = keypad.querySelector(`[id$="-key-${suffix}"]`);
      if (button && !button.disabled) { keypad.focus({ preventScroll: true }); button.click(); }
      return;
    }
    if (key === 'Enter') {
      if (event.repeat) { event.preventDefault(); return; }
      // PINs auto-submit at their full length; their hook handles a retry on Enter.
      if (keypad?.matches('.pin-keypad') && (active === root || keypad.contains(active))) return;
      const inWeightKeypad = keypad?.matches('.weight-keypad') && keypad.contains(active);
      if (inWeightKeypad) event.preventDefault();
      if (!inWeightKeypad && active?.matches('button, a, input, select')) return;
      const submit = root.querySelector('#weight-save, .primary-button:not(.danger-button)');
      if (submit && !submit.disabled) { event.preventDefault(); submit.click(); }
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    const group = active?.closest(GROUPS);
    if (group) event.preventDefault();
    const items = controls(group || root);
    if (!items.length) return;
    const index = items.indexOf(active);
    const rects = items.map((item) => {
      const rect = item.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    let next = index < 0 ? 0 : directionalIndex(rects, index, key);
    const choices = group?.matches('[role="radiogroup"], [role="tablist"], .theme-options, .font-options');
    if (next < 0 && choices) next = (index + (key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    if (next >= 0) {
      event.preventDefault(); items[next].focus();
      if (choices && items[next].matches('[role="radio"], [role="tab"], [aria-pressed]')) items[next].click();
    }
  };
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', rememberTrigger, true);
  return () => {
    observer.disconnect();
    window.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('click', rememberTrigger, true);
  };
}
