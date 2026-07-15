'use strict';
if (!window.smp) window.smp = { on() {}, openPreview() {}, hideButton() {} };
const btn = document.getElementById('btn');
document.getElementById('ico').innerHTML = window.SMPIcons.bookmark(20);

// Animate in/out on main-process cues (150–200ms per spec).
window.smp.on('button:show', () => {
  requestAnimationFrame(() => btn.classList.add('in'));
});
window.smp.on('button:hide', () => {
  btn.classList.remove('in');
});

btn.addEventListener('click', async () => {
  btn.classList.remove('in');
  try {
    await window.smp.openPreview();
  } catch (e) {
    // main handles the error surface; nothing to do here.
  }
});

// Appear immediately if the window was shown before the event landed.
requestAnimationFrame(() => btn.classList.add('in'));
