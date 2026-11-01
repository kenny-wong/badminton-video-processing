import { paths, visualIcon } from './icons.js';

const root = document.documentElement;
const themeButton = document.querySelector('#theme');
const setTheme = (dark) => {
  root.dataset.theme = dark ? 'dark' : 'light';
  themeButton.textContent = dark ? 'Light preview' : 'Dark preview';
  themeButton.setAttribute('aria-pressed', String(dark));
};
setTheme(matchMedia('(prefers-color-scheme: dark)').matches);
themeButton.addEventListener('click', () => setTheme(root.dataset.theme !== 'dark'));

for (const tile of document.querySelectorAll('[data-icon]')) tile.append(visualIcon(tile.dataset.icon, 26));

const labels = { shuttle: 'Shuttle', court: 'Court', rally: 'Rally', scoreboard: 'Scoreboard',
  tracking: 'Shuttle tracking', highlights: 'Highlights', 'rally-cut': 'Rally cuts',
  'voice-clean': 'Voice removal', export: 'Export', 'match-video': 'Match video' };
for (const name of Object.keys(paths)) {
  const button = document.createElement('button');
  button.className = 'icon-option';
  button.type = 'button';
  button.title = `Copy usage for ${labels[name]}`;
  const label = document.createElement('span');
  label.textContent = labels[name];
  button.append(visualIcon(name, 28), label);
  button.addEventListener('click', async () => {
    const usage = `visualIcon('${name}', 24)`;
    const status = document.querySelector('#copy-status');
    try {
      await navigator.clipboard.writeText(usage);
      status.textContent = `Copied: ${usage}`;
    } catch {
      status.textContent = `Usage: ${usage}`;
    }
  });
  document.querySelector('#icon-grid').append(button);
}
