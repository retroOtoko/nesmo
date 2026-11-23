// Controls sheet: how the space between A and B behaves, plus the Mac keys.
import { h } from './dom';
import { loadControlSettings, saveControlSettings, type BetweenMode } from './touchpad';

const OPTIONS: { id: BetweenMode; title: string; detail: string }[] = [
  { id: 'both', title: 'Press both', detail: 'Rest your thumb in the gap between A and B to hold both. Sliding from B toward A works too.' },
  { id: 'wide', title: 'Press both, wider zone', detail: 'More of the inner edges of A and B count as both. Easier to hit, easier to trigger by accident.' },
  { id: 'off', title: 'Nearest button only', detail: 'The gap presses whichever button is closer. Each thumb presses one button.' },
];

export function openControlsSettings() {
  const settings = loadControlSettings();
  const list = h('div', { class: 'opt-list' });
  const render = () => {
    list.replaceChildren(
      ...OPTIONS.map((o) =>
        h('button', {
          class: 'opt' + (settings.between === o.id ? ' on' : ''),
          role: 'radio',
          'aria-checked': settings.between === o.id ? 'true' : 'false',
          onclick: () => {
            settings.between = o.id;
            saveControlSettings(settings);
            render();
          },
        },
          h('span', { class: 'opt-dot' }),
          h('span', { class: 'opt-text' }, h('b', null, o.title), h('span', { class: 'muted small' }, o.detail)),
        ),
      ),
    );
  };
  render();

  const close = () => {
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 220);
  };
  const sheet = h('div', { class: 'sheet' },
    h('div', { class: 'sheet-scrim', onclick: close }),
    h('div', { class: 'sheet-panel', role: 'dialog', 'aria-label': 'Controls' },
      h('div', { class: 'row-between' }, h('h2', null, 'Controls'), h('button', { class: 'btn', onclick: close }, 'Done')),
      h('h3', null, 'Between A and B'),
      list,
      h('h3', null, 'Keyboard on a Mac'),
      h('p', { class: 'muted small' }, 'Arrow keys or WASD to move, Z for B, X for A, Enter for Start, Right Shift for Select. Click the game screen first so the editor lets go of the keys.'),
      h('h3', null, 'Gamepad'),
      h('p', { class: 'muted small' }, 'A paired Bluetooth controller works too. Press any button on it once NesMo is open.'),
    ),
  );
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
}
