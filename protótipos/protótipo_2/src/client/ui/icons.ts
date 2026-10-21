/**
 * Small vector icons (inline SVG, 24x24 view box) drawn in the HUD's palette: a light fill with an
 * ink outline, so they read on the dark panels at any size.
 */
const INK = '#1b1424';
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

export const ICONS: Record<string, string> = {
  icon_sword: svg(
    '<path d="M19.5 3.5 21 3l-.5 1.5-9.7 9.7-1.9-1.9z" fill="#dfe4ea"/>' +
      '<path d="M7.2 11.6l5.2 5.2-1.4 1.4-1.6-1-2.6 2.6.3 1.4-1.6 1.6-3.3-3.3 1.6-1.6 1.4.3 2.6-2.6-1-1.6z" fill="#c9a24a"/>' +
      '<path d="M6.3 15.6l2.1 2.1" stroke="#7a4e30" stroke-width="2.4"/>',
  ),
  icon_armor: svg(
    '<path d="M8 3h8l1.5 2.5L21 7l-1.5 5-2.5-1v9.5c-3 1.3-7 1.3-10 0V11l-2.5 1L3 7l3.5-1.5z" fill="#bcc4ce"/>' +
      '<path d="M9 3.2c.6 1.7 1.6 2.6 3 2.6s2.4-.9 3-2.6" fill="none"/>' +
      '<path d="M7 14h10M7 17.2h10" fill="none" stroke-width="1.2"/>' +
      '<circle cx="12" cy="10" r="1.4" fill="#c9a24a" stroke-width="1"/>',
  ),
  bag: svg(
    '<path d="M5 9.5c0-1.4 1.1-2.5 2.5-2.5h9c1.4 0 2.5 1.1 2.5 2.5V19c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2z" fill="#b07a48"/>' +
      '<path d="M9 7V5.5C9 4.1 10.3 3 12 3s3 1.1 3 2.5V7" fill="none" stroke-width="1.8"/>' +
      '<path d="M5 12h14v2.5H5z" fill="#7a4e30"/><rect x="10.5" y="11.5" width="3" height="3.5" rx=".6" fill="#c9a24a" stroke-width="1"/>',
  ),
  menu: svg('<path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="#f4e8d0" stroke-width="2.6"/>'),
};
