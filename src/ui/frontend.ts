/**
 * DRIVE FM front end: boot card, title, pause menu (resume / graphics / controls), controls card,
 * boost meter and touch controls. Pure DOM + CSS over the game canvas; no per-frame layout.
 *
 * Input contract with the game:
 * - While the title or pause menu is up, this module handles the keyboard itself (capture phase on
 *   window) and stops propagation of the keys it consumes, so the game never sees them. Mouse, pen and
 *   touch are handled here too. The game forwards gamepad navigation through `menu()`.
 * - `start()` / `resume()` hide the title / pause menu themselves before calling the handler; calling
 *   `hideTitle()` / `hidePause()` again from the game is harmless.
 * - Touch controls show on the first touch and hide on keyboard use; the game may also call
 *   `setTouchVisible()` (e.g. hide on gamepad use). They are only drawn while driving.
 */
import './frontend.css';

export type GraphicsLevel = 'high' | 'low' | 'verylow';
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';
export interface FrontEndHandlers {
  start(): void;
  resume(): void;
  graphics(level: GraphicsLevel): void;
}
export interface TouchState {
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  boost: boolean;
  reset: boolean;
}

const STORAGE_KEY = 'drivefm.graphics';
const LEVELS: readonly GraphicsLevel[] = ['high', 'low', 'verylow'];
const LEVEL_LABEL: Record<GraphicsLevel, string> = { high: 'HIGH', low: 'LOW', verylow: 'VERY LOW' };
const ITEMS = ['resume', 'graphics', 'controls'] as const;
const TABS = ['KEYBOARD', 'GAMEPAD', 'TOUCH'] as const;
type InputMode = 'kbd' | 'pad' | 'touch';

// ---------------------------------------------------------------------------------------------
// Logo: baked from Dela Gothic One (DRIVE) and Sedgwick Ave Display (FM) outlines, both OFL.
// Two layers with the same viewBox so the tag can spray in over the sticker.
// ---------------------------------------------------------------------------------------------
/*LOGO-BEGIN*/
const LOGO_DRIVE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-56 -201.1 983.6 619"><defs><linearGradient id="dfm-chr" gradientUnits="userSpaceOnUse" x1="0" y1="-151" x2="0" y2="0"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="#cfe0ff"/><stop offset=".53" stop-color="#7d8fd0"/><stop offset=".55" stop-color="#1a1f55"/><stop offset=".66" stop-color="#3b4fe0"/><stop offset=".88" stop-color="#a6f3ff"/><stop offset="1" stop-color="#fff"/></linearGradient><g id="dfm-dv"><path d="M174.9 -75.4Q174.9 -52.7 164.6 -35.7Q154.4 -18.7 133.9 -9.3Q113.4 0 83.4 0Q65.2 0 46.3 0Q27.5 0 8.2 -0.2Q9.8 -40.6 9.8 -75.4Q9.8 -110.7 8.2 -149Q32.6 -151.1 73.8 -151.1Q112.3 -151.1 134.7 -141.8Q157 -132.4 165.9 -115.9Q174.9 -99.4 174.9 -75.4ZM89.2 -40.8Q108.2 -40.8 114.6 -50Q120.9 -59.2 120.9 -75.4Q120.9 -91 114.3 -100.7Q107.6 -110.3 89.2 -110.3Q69.3 -110.3 59.4 -109.1V-40.8Z"/><path d="M311.6 -51.2Q314.1 -48 315.1 -46.1L348.3 0H292.5Q283.5 -16.8 264 -47.6H233.9V0H185.5Q187.2 -39.8 187.2 -74.4Q187.2 -109.1 185.5 -148.8H233.9V-148.6H275.9Q317.3 -148.6 333.7 -135.3Q350.1 -122 350.1 -99.2Q350.1 -81.4 341.4 -69.1Q332.7 -56.8 311.6 -51.2ZM233.9 -109.3V-85.9H261.6Q279 -85.9 287.9 -87Q296.8 -88.1 300.3 -90.6Q303.8 -93.1 303.8 -97.8Q303.8 -102.3 300.5 -104.8Q297.2 -107.2 288.2 -108.2Q279.2 -109.3 261.6 -109.3Z"/><path d="M479.9 -108Q455.5 -109.3 443.8 -109.5V-39.4Q455.7 -39.6 479.9 -40.8V0H360.8V-40.8Q384.4 -39.6 396.7 -39.4V-109.5Q384.4 -109.3 360.8 -108V-148.8H479.9Z"/><path d="M664.8 -148.8 651.3 -117.5Q633.4 -75.8 623.2 -50.8Q612.9 -25.8 604.3 0H543Q534.6 -25.4 524.5 -50.3Q514.3 -75.2 497.3 -114.2Q494.5 -120.7 482.4 -148.8H539.4Q545.5 -128.9 557.6 -97.8Q568.3 -70.3 574.8 -50.2Q579.1 -64.4 585.2 -80.5Q591.2 -96.6 592.4 -100Q604.3 -131.4 609.9 -148.8Z"/><path d="M718.3 -37.5Q796.2 -37.9 831.3 -39.8Q829.8 -31.4 829.5 -22.4Q829.2 -13.5 829.2 0H669.9Q671.6 -39.8 671.6 -74.4Q671.6 -109.1 669.9 -148.8H829.2V-111.7H718.3V-92Q728.2 -91.8 747.4 -91.8Q780 -91.8 814.9 -93.1V-57.8Q780 -59 747.4 -59Q728.2 -59 718.3 -58.8Z"/></g></defs><g class="dfm-drive" transform="skewX(-12)"><g transform="translate(12 16)" fill="#10101e" stroke="#10101e" stroke-width="44.0" stroke-linejoin="round" opacity=".42"><use href="#dfm-dv"/><use href="#dfm-dv" transform="translate(9 16)"/></g><g fill="#fffaf0" stroke="#fffaf0" stroke-width="44.0" stroke-linejoin="round"><use href="#dfm-dv"/><use href="#dfm-dv" transform="translate(9 16)"/></g><g fill="#10101e" stroke="#10101e" stroke-width="10.0" stroke-linejoin="round"><use href="#dfm-dv" transform="translate(9 16)"/></g><g fill="#ff2d88"><use href="#dfm-dv" transform="translate(8.8 16)"/><use href="#dfm-dv" transform="translate(7.7 14)"/><use href="#dfm-dv" transform="translate(6.6 12)"/><use href="#dfm-dv" transform="translate(5.5 10)"/><use href="#dfm-dv" transform="translate(4.4 8)"/><use href="#dfm-dv" transform="translate(3.3 6)"/><use href="#dfm-dv" transform="translate(2.2 4)"/><use href="#dfm-dv" transform="translate(1.1 2)"/></g><g stroke="#10101e" stroke-width="8.0" stroke-linejoin="round" fill="url(#dfm-chr)" paint-order="stroke"><use href="#dfm-dv"/></g></g></svg>';
const LOGO_TAG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-56 -201.1 983.6 619"><defs><linearGradient id="dfm-lime" gradientUnits="userSpaceOnUse" x1="0" y1="-120" x2="0" y2="60"><stop offset="0" stop-color="#c8ff1a"/><stop offset="1" stop-color="#9be600"/></linearGradient><filter id="dfm-rough" x="-10%" y="-10%" width="120%" height="125%"><feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="4" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation=".55"/></filter><filter id="dfm-mist" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="2.5" result="d"/><feGaussianBlur in="d" stdDeviation="4" result="a"/><feGaussianBlur in="d" stdDeviation="11" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="a"/></feMerge><feComponentTransfer><feFuncA type="linear" slope=".62"/></feComponentTransfer></filter><g id="dfm-fm"><path d="M183.2 -281.8Q183.2 -276.2 179.7 -269.1Q176.2 -262 171.9 -256.7Q167.6 -251.5 163.8 -249.6Q160.1 -247.8 155.4 -247.8L146.2 -248.2Q141.6 -248.2 138.9 -247.5Q122.8 -244.2 104.6 -238.9Q104.3 -238.9 97.4 -237.3Q96 -236.9 90.9 -235.8Q85.8 -234.6 82 -233.3Q78.2 -232 76.6 -230Q73.3 -226.7 73.3 -219.8Q73.3 -213.2 76.1 -204.1Q78.9 -195 79.2 -193.4Q82.8 -183.2 83.2 -178.9Q96.4 -183.5 114.5 -188.3Q132.7 -193.1 146.5 -193.1Q166 -193.1 166 -181.5Q166 -176.2 161.7 -168Q157.1 -160.1 150.8 -156.1Q144.5 -152.1 137.9 -151Q131.3 -149.8 120.1 -148.8Q118.1 -148.8 114.3 -148.5Q110.6 -148.2 107.9 -147.8Q106.3 -147.5 100.7 -147Q95 -146.5 91.1 -144.9Q86.1 -142.9 85 -142.1Q83.8 -141.2 83.8 -139.1Q83.8 -137 83.5 -133Q82.8 -123.8 80.2 -105.3L79.2 -98.3Q75.9 -75.9 72.3 -59.4Q68.6 -42.9 62 -27.7Q57.4 -17.8 49 -6.9Q40.6 4 32.3 4Q30 4 28.1 3Q22.1 0 22.1 -15.2Q22.1 -25.1 25.4 -45.5L26.4 -53.1L31.7 -102.3Q33.7 -116.8 34.3 -124.1L28.7 -120.8Q13.5 -110.9 6.9 -110.9Q4.3 -110.9 2.6 -112.2Q-0.7 -115.2 -0.7 -119.1Q-0.7 -126.1 6.6 -134.3Q13.9 -142.6 20.8 -147.5Q23.8 -149.8 27.4 -151.5Q33.7 -155.4 36.5 -158.9Q39.3 -162.4 39.3 -170Q39.3 -175.6 37 -182.5Q35.3 -187.1 32 -191.6Q28.7 -196 28.1 -197Q23.4 -203.6 21.1 -207.7Q18.8 -211.9 18.8 -216.8Q18.8 -220.8 20.8 -225.7Q25.4 -236.3 36.5 -243.5Q47.5 -250.8 65 -258.4L73.9 -262.4Q100.7 -274.9 123.9 -282.6Q147.2 -290.4 169.6 -291.7Q183.2 -292.7 183.2 -281.8Z"/><path d="M344.9 -36.6Q344.9 -30 340.6 -22.3Q336.3 -14.5 329.7 -9.4Q323.1 -4.3 316.8 -4.3Q302.9 -4.3 299 -29.7Q297.7 -38.9 297.7 -50.5Q297.7 -56.4 298.3 -69L298.7 -87.5Q298.7 -102 299.3 -131Q300.3 -160.4 300.3 -189.4Q292.1 -167.3 279.5 -128.7Q275.9 -117.5 272.2 -110.2Q268.6 -103 261.7 -97.4Q255.1 -91.7 248.5 -91.7Q236 -91.7 227.7 -108.6Q219.5 -125.4 213.5 -146.5L210.5 -122.1Q206.3 -89.1 202.8 -69.3Q199.3 -49.5 192.7 -29.7Q187.8 -14.9 181.3 -4.5Q174.9 5.9 164.7 5.9Q153.1 5.9 153.1 -5.9Q153.1 -14.2 158.1 -24.8Q157.7 -24.1 157.6 -23.6Q157.4 -23.1 157.1 -23.1L159.1 -29.4Q162 -39.3 164.3 -52.8Q169.3 -77.9 173.6 -109.2L181.5 -167Q185.1 -198 189.4 -226.7Q191.7 -243.5 194.5 -253.3Q197.3 -263 204.9 -271.9Q208.6 -276.2 213.3 -278.9Q218.1 -281.5 222.4 -281.5Q229.7 -281.5 233.3 -274.9Q236 -269.9 236.6 -258.7L237.6 -250.8Q239.9 -238.6 243.5 -224.1Q252.5 -188.4 259.7 -169.3Q262.4 -177.2 263 -178.9Q272.2 -205.9 279.7 -223.7Q287.1 -241.6 297.7 -256.7Q302.6 -263.7 308.9 -268.8Q315.2 -273.9 321.4 -273.9Q328.4 -273.9 331.5 -269.1Q334.6 -264.3 335.4 -259.5Q336.3 -254.8 337.3 -243.5Q338.6 -228.7 338.6 -209.2Q338.6 -195 337.3 -166Q336.9 -160.1 336.6 -151.1Q336.3 -142.2 336.3 -130.3L335.9 -107.9Q335.9 -97 336.6 -75.9L336.3 -65.3Q336.3 -50.2 340.9 -46.2Q344.9 -43.2 344.9 -36.6Z"/><path d="M-35.6 43.3L-23.2 45.8L-10.5 48L2.7 49.8L16.1 51.5L29.9 52.8L43.9 53.9L58.2 54.7L72.8 55.2L87.5 55.5L102.5 55.5L117.6 55.2L132.8 54.7L148.1 53.9L163.5 52.8L179 51.4L194.4 49.8L209.9 47.9L225.3 45.7L240.7 43.2L256 40.5L271.2 37.5L286.3 34.2L301.1 30.7L315.8 26.8L330.3 22.7L344.6 18.3L358.5 13.7L372.2 8.7L371.7 7.3L357.8 11.5L343.7 15.4L329.3 19.1L314.8 22.5L300 25.6L285.1 28.5L270 31.1L254.8 33.5L239.6 35.6L224.3 37.4L208.9 39L193.5 40.3L178.2 41.4L162.9 42.2L147.6 42.8L132.5 43.2L117.4 43.2L102.5 43.1L87.8 42.7L73.3 42.1L59 41.2L45 40.1L31.2 38.7L17.8 37.2L4.7 35.4L-8.1 33.3L-20.5 31.1L-32.4 28.7Z"/></g><path id="dfm-dr" d="M295.8 290.5C302.4 295.5 302.7 314.7 302.7 355A7.6 7.6 0 1 0 310.7 355C310.7 314.7 311 295.5 317.6 290.5ZM352.2 131.9C356.8 136.9 357 144.1 357 157.8A5.2 5.2 0 1 0 362.4 157.8C362.4 144.1 362.6 136.9 367.2 131.9ZM422.3 277.9C427.9 282.9 428.1 294.9 428.1 319.1A6.4 6.4 0 1 0 434.8 319.1C434.8 294.9 435.1 282.9 440.7 277.9ZM504.1 167.7C509.3 172.7 509.6 188.3 509.6 221.1A6 6 0 1 0 515.9 221.1C515.9 188.3 516.1 172.7 521.3 167.7ZM572.7 249C579.7 254 580 279.2 580 333.2A8 8 0 1 0 588.4 333.2C588.4 279.2 588.7 254 595.7 249ZM313.4 340.1C319 345.1 319.2 358.9 319.2 387.2A6.4 6.4 0 1 0 326 387.2C326 358.9 326.2 345.1 331.8 340.1ZM430.8 326.2C435.3 331.2 435.5 339 435.5 354.1A5.2 5.2 0 1 0 441 354.1C441 339 441.2 331.2 445.7 326.2Z"/></defs><g class="dfm-tag"><g filter="url(#dfm-rough)"><g fill="#10101e" stroke="#10101e" stroke-linejoin="round"><use href="#dfm-fm" transform="translate(4 6) translate(270 300) rotate(-7)" stroke-width="15.0" filter="url(#dfm-mist)" opacity=".45"/><use href="#dfm-fm" transform="translate(4 6) translate(270 300) rotate(-7)" stroke-width="15.0"/><use href="#dfm-dr" transform="translate(4 6)" stroke-width="15.0"/></g><g fill="#c8ff1a" stroke="#c8ff1a" stroke-linejoin="round"><g transform="translate(270 300) rotate(-7)" stroke-width="3.0"><use href="#dfm-fm" filter="url(#dfm-mist)"/><use href="#dfm-fm" fill="url(#dfm-lime)" stroke="url(#dfm-lime)"/></g><use href="#dfm-dr" stroke-width="2" fill="#9be600" stroke="#9be600"/></g></g><g transform="translate(270 300) rotate(-7)" stroke-linecap="round" fill="none"><path d="M49.7 -185.1Q53.2 -191.1 56.7 -184.5L47.2 -122.8ZM48.1 -109.2a2.2 2.2 0 1 0-4.4 0a2.2 2.2 0 1 0 4.4 0ZM215.2 -251.3Q218.5 -256.7 221.7 -250.3L210.5 -198.8ZM210.9 -187.4a2.2 2.2 0 1 0-4.4 0a2.2 2.2 0 1 0 4.4 0ZM311.2 -251.1Q314.2 -256.2 317.1 -250.5L310.2 -206.8ZM311.5 -197.1a2.2 2.2 0 1 0-4.4 0a2.2 2.2 0 1 0 4.4 0Z" fill="#fff" stroke="none" opacity=".9"/><g stroke="#c8ff1a"><path stroke-width="1.3" d="M208.5 -279.5h0M199 -270.4h0M171.5 -247.1h0M168.8 -247.5h0M158.5 -243.6h0M156.6 -234.6h0M152.6 -231.9h0M144.8 -244.5h0M143.5 -232h0M140.4 -235.8h0M136.5 -225.9h0M132.2 -227.6h0M132.3 -217.9h0M119.3 -238.4h0M119.6 -227.6h0M109.6 -236.1h0M108.8 -228h0M105.2 -233.5h0M105.3 -233h0M105.6 -228.2h0M104.4 -230.1h0M98.2 -233.6h0M98.1 -230.6h0M98 -213.7h0M92.6 -212.4h0M90.6 -214.6h0M86.2 -222.6h0M83.3 -223.9h0M85.5 -220.9h0M86 -221.1h0M79.2 -215.4h0M81.1 -213.6h0M84.4 -206.2h0M91 -199.6h0M91.2 -191.3h0M90 -185.1h0M88.6 -181.9h0M94.7 -188.1h0M98.8 -189.8h0M103.1 -194.9h0M113 -200.1h0M114 -210.3h0M133.9 -199.9h0M148.7 -217.9h0M178.5 -193.5h0M176.3 -183.7h0M176.3 -179.3h0M170.9 -151.2h0M164.1 -144.5h0M154.7 -149h0M146.4 -149.6h0M130.8 -129.4h0M119.8 -131.2h0M120 -123.6h0M117.5 -134.2h0M114.6 -124.3h0M112.9 -132.7h0M110.2 -143.6h0M108.9 -138.8h0M109.7 -128.8h0M108.3 -118.4h0M99.2 -139.5h0M99.5 -127.5h0M93.6 -134h0M92.8 -129.2h0M96.4 -123.9h0M87.9 -139.2h0M105.3 -134.5h0M115 -138.1h0M89 -138.7h0M96 -137.1h0M98.5 -133.7h0M89.6 -131.6h0M115.4 -124.5h0M91.1 -102.5h0M85.8 -101h0M85.8 -90.5h0M110.5 -77.2h0M90.4 -77.3h0M81.3 -67.1h0M86.4 -64.2h0M101.1 -53.3h0M94.1 -53.9h0M83.6 -49.7h0M84.7 -45.5h0M92.2 -38.8h0M73.2 -41.3h0M79.3 -36.2h0M69.8 -32.2h0M83.2 -24.5h0M79.7 -20.9h0M67.7 -21.8h0M22.4 -42.4h0M78.5 -5.5h0M53.5 -6.9h0M52.8 -5h0M52.1 0h0M49.2 3.1h0M37.7 9.7h0M34 18.5h0M25.9 18.7h0M10.9 -2.6h0M55.1 -12.4h0M7.8 -13.6h0M9.6 -23.1h0M7.2 -40.5h0M9.6 -41.6h0M3.5 -47.3h0M1.1 -51.7h0M9.4 -56h0M22 -60.9h0M0.7 -67h0M-1.6 -75.5h0M0.2 -76.4h0M19.3 -77.7h0M7.2 -84.4h0M21.7 -85.8h0M2.1 -107.4h0M7.9 -146.1h0M27.8 -103.9h0M-10 -105.4h0M-9.4 -109.7h0M-37.8 -100.8h0M-14.1 -120.6h0M-10.6 -139.3h0M3.3 -138.5h0M5.7 -147.2h0M6.4 -156.4h0M13.6 -153.9h0M5.1 -168.9h0M17.7 -160.6h0M21.8 -157.8h0M25.6 -163h0M18.9 -173.5h0M21.5 -170h0M34 -161.9h0M19.8 -170h0M23.5 -170.6h0M29.4 -171h0M29.3 -172.7h0M34.4 -177.1h0M32.5 -181.7h0M23.7 -179.5h0M17.6 -179.1h0M25.9 -186.2h0M20.3 -183h0M8.2 -183.6h0M10.3 -206h0M9.3 -208.6h0M8 -219.9h0M12.6 -221.5h0M-14.9 -231.2h0M-4.2 -230.6h0M9.7 -234h0M-1.3 -245.5h0M6.9 -259.5h0M34.8 -253.6h0M32.9 -266.9h0M33 -271.4h0M46.3 -254.2h0M46 -260.4h0M50.9 -269h0M58.8 -261.4h0M59.8 -272.8h0M73.4 -266.3h0M72.4 -276.3h0M80.1 -276.4h0M86.1 -291.4h0M90.1 -288.6h0M103.4 -281.4h0M101.8 -289.1h0M114.7 -293.7h0M122.8 -290h0M130.7 -296.5h0M134.7 -313.5h0M149.5 -293.9h0M151.3 -295.3h0M155.6 -301.9h0M164.7 -242.9h0M159.1 -312.7h0M162.1 -318h0M164.1 -299.4h0M168.1 -296.6h0M172.1 -307.3h0M183.2 -281.8h0M350.2 -25.2h0M348.7 -21.1h0M348.6 -16.9h0M335 -1.3h0M330.4 -1.4h0M329.8 8.1h0M326.3 9.3h0M321.3 5.7h0M301.1 -1.7h0M283.1 -11.9h0M275.9 -22h0M295.2 -30h0M294.1 -61.2h0M289.3 -67.4h0M272.7 -72.9h0M278.9 -75.2h0M276.7 -78.2h0M293.6 -83.8h0M292.7 -93.5h0M278.4 -116.9h0M285.4 -132.5h0M286.7 -139.7h0M288.6 -141.1h0M292 -155.1h0M295.8 -175.3h0M295 -159.4h0M298.7 -153.5h0M293.3 -152.9h0M292.4 -130.2h0M288.2 -130.7h0M280.2 -116.6h0M277.7 -110.4h0M279.1 -106.4h0M278.9 -101.6h0M272.2 -95.8h0M279.9 -84h0M279.4 -79.5h0M267.3 -83.3h0M229.3 -89.3h0M230.4 -97h0M219.5 -115.9h0M213.8 -117.4h0M220.9 -112.8h0M213.6 -113.6h0M216.6 -107.1h0M217.4 -101.6h0M228.5 -96h0M217.7 -80.1h0M227.1 -77.5h0M222.1 -75.1h0M208.1 -74.3h0M160.9 -77.1h0M212.4 -58.8h0M211.8 -51.4h0M206.6 -43.6h0M199.8 -24.8h0M217.6 -15.9h0M197.1 -11.8h0M187.3 -5.3h0M186.4 6.4h0M187.3 18.9h0M176.1 7.8h0M162.4 9.5h0M155.2 14.3h0M143.5 0.9h0M130 -2.1h0M147.2 -8.3h0M131.5 -36.8h0M128.7 -35h0M153.5 -25.6h0M152.8 -27.1h0M146.9 -26.6h0M141.3 -34.9h0M143.8 -36.7h0M147.6 -47.2h0M152.8 -70.3h0M154 -74.5h0M164.1 -78.7h0M153.7 -99.2h0M159.3 -102.9h0M163.1 -112.3h0M169.3 -129.2h0M169.4 -132.4h0M171.3 -133.9h0M172.3 -139.2h0M164.9 -151h0M174.7 -162.4h0M163.3 -168.1h0M164.5 -169.2h0M171.7 -186.9h0M159 -201h0M178.6 -201.8h0M182.1 -204.6h0M163.3 -208.3h0M183.8 -230h0M189.1 -258.3h0M185.3 -276.6h0M191.8 -280.4h0M192.4 -283.3h0M203.2 -280.4h0M208.4 -286h0M215.5 -287.3h0M223.5 -288h0M229.5 -286.1h0M233.6 -283.6h0M269.3 -298.5h0M249 -280.2h0M244.5 -263.4h0M257.7 -263.2h0M244.9 -238.2h0M278.6 -242.3h0M252.6 -232.9h0M257.9 -213.2h0M256.3 -210.1h0M260.9 -209.6h0M255.1 -205h0M255.1 -201.9h0M254.3 -198.2h0M255.3 -195.3h0M296.5 -173.8h0M257.2 -201.1h0M268.5 -212.4h0M270 -217.3h0M249 -228.1h0M265.6 -223.8h0M270.2 -236h0M283.8 -257.8h0M291.8 -254.6h0M297.1 -265.9h0M301.2 -283.2h0M307.3 -278.9h0M307.2 -297.9h0M316.7 -280.4h0M319.8 -293.8h0M324.5 -290.5h0M342.3 -295.5h0M365.3 -311.6h0M334.4 -271.9h0M346.6 -276.3h0M337.4 -266.2h0M357.3 -268.9h0M346.6 -262.8h0M344.2 -254.4h0M345.5 -251h0M351.8 -245.8h0M352.3 -244.1h0M356.8 -233.9h0M359 -229.2h0M344.4 -227.5h0M347 -223.6h0M359.4 -222h0M361.5 -214.5h0M353.5 -207.4h0M344 -194.2h0M353.2 -183.3h0M351.9 -178.7h0M351.5 -174.1h0M366.4 -167.7h0M346.6 -166.7h0M360.6 -159.4h0M343.7 -148h0M350 -146.8h0M357.3 -133h0M340.8 -129.9h0M339.9 -125.4h0M356.3 -119.2h0M352.6 -107.8h0M367.8 -104h0M354.4 -101h0M350 -96.3h0M340.3 -65.6h0M350 -61.7h0M347 -60.4h0M361.8 -61h0M345.5 -54.3h0M355.7 -58.7h0M356.6 -61.7h0M355.2 -41.6h0"/><path stroke-width="2.1" d="M188.1 -278h0M187.6 -275.5h0M182.7 -267.1h0M182.2 -259.4h0M178.7 -252.5h0M173.3 -232.6h0M162.8 -241.9h0M153.7 -290.6h0M144 -235.9h0M141.5 -243.6h0M113.3 -231.8h0M95.8 -232.7h0M84 -227.6h0M84.3 -222.4h0M83.7 -223.4h0M85.4 -222.9h0M78.7 -220.3h0M86.1 -192.7h0M101.6 -209.3h0M144.1 -201.4h0M168.3 -195.1h0M168.2 -170.5h0M167.1 -166.7h0M168.1 -164h0M158.3 -156.9h0M155.9 -151.1h0M138.1 -142.5h0M127.4 -139.3h0M115 -135.2h0M102.5 -137.5h0M101.3 -135h0M97.8 -141.6h0M88.9 -133.8h0M97 -112.9h0M85.8 -109.1h0M88.5 -105.3h0M105.1 -81.9h0M86.8 -71.7h0M74.6 -43.9h0M74 -5.7h0M30.7 9.2h0M29.6 8.6h0M26.1 12.6h0M27 6.5h0M17.2 15.7h0M6.7 13.8h0M12.7 -8.3h0M19.4 -42.4h0M15.7 -57.3h0M19 -69.4h0M25.4 -88.9h0M18.8 -91.8h0M14.6 -93.2h0M17.4 -102.2h0M27.8 -115h0M16 -106.6h0M4 -105.9h0M-0.9 -109.5h0M-26.3 -117.1h0M24.2 -158h0M27.3 -158.5h0M24.7 -183.5h0M24.2 -191h0M23.6 -193.1h0M14.6 -212.3h0M14.8 -215.6h0M13.9 -228h0M28 -246h0M21.7 -258h0M48.5 -261.8h0M80.1 -270.7h0M88 -274.8h0M114.6 -289.6h0M131.5 -300.6h0M137.8 -291.7h0M176.9 -296.4h0M190.1 -295.9h0M363.8 -35.1h0M345.3 -14.4h0M339.6 -9.5h0M308 -2.6h0M301.8 -6.3h0M297.7 -10h0M274.9 -43.6h0M293.7 -50.7h0M291.5 -53.8h0M289.4 -89.1h0M293.8 -128.5h0M341.5 -146.9h0M299.9 -172h0M272.4 -102.7h0M256.1 -86h0M233.8 -88.4h0M227 -89.1h0M222.3 -109.1h0M212.1 -122.9h0M211.2 -126h0M213.6 -132.8h0M215.8 -104.8h0M213.3 -99.1h0M212.5 -94.7h0M217.7 -91.4h0M206.9 -63.8h0M213.7 -40.5h0M200.1 -20.4h0M191.1 -13.9h0M191.4 -10.7h0M190.3 -9.1h0M154.3 8.6h0M148.9 4.8h0M150.1 -13.9h0M145.1 -19.4h0M151 -27.2h0M151.4 -25.9h0M157 -36.5h0M151.8 -58.4h0M155.9 -76.2h0M161.4 -81.4h0M161 -87.4h0M156.8 -104.9h0M169.1 -117.2h0M166.9 -119.6h0M169.6 -122.2h0M156.2 -125.9h0M176.1 -154.7h0M174.8 -164h0M176.1 -177.1h0M177.6 -182.5h0M174.4 -215.1h0M167.1 -222.4h0M175 -221.9h0M213.1 -284.9h0M218.8 -292h0M259.7 -269.7h0M253 -230.1h0M255.2 -229.2h0M258.2 -215.7h0M264 -188.1h0M259.6 -179.7h0M259 -196h0M264.1 -194.7h0M260.9 -211.3h0M275.4 -230h0M283.9 -242h0M292.9 -259.9h0M292 -274.9h0M302.4 -268h0M326.2 -282.4h0M338.5 -265.2h0M350.4 -216.6h0M345.3 -188.9h0M343.7 -187h0M342.2 -170.4h0M345.6 -156.3h0M343.6 -140.4h0M344.1 -135.9h0M341.6 -112.6h0M346.2 -106.6h0M347.6 -69.4h0M347.9 -63.5h0M351.4 -44h0"/><path stroke-width="3.0" d="M181.5 -253.8h0M166.2 -241h0M166.3 -237.8h0M97.5 -228h0M82.4 -189.2h0M124 -196h0M140.7 -199.6h0M154.5 -202.5h0M161.7 -200.4h0M146.6 -146.9h0M142.2 -147.4h0M140.7 -139.5h0M115.2 -140.4h0M89.4 -92.4h0M81.1 -61.7h0M60.3 -6.8h0M49 8.9h0M31.6 7.6h0M24.7 -111.3h0M31.1 -116.6h0M19.4 -111.2h0M-1.6 -102.4h0M32.9 -160.2h0M12.5 -213.5h0M65.6 -270.1h0M89.8 -275.4h0M100.2 -279.4h0M180 -294.3h0M189.1 -290.1h0M335.4 -6h0M298.1 -9.1h0M292.7 -28h0M292 -33.4h0M292.6 -69.5h0M294.9 -80.8h0M291.3 -91.2h0M289.4 -115.8h0M289.5 -119.8h0M293.2 -123.5h0M293.7 -144h0M293.5 -150.8h0M291.6 -160.6h0M289.5 -133.8h0M281.8 -122.6h0M283.5 -118.9h0M245.7 -87.5h0M211 -124.3h0M216.7 -87h0M210.8 -71.9h0M206.5 -48.8h0M146 -12.1h0M154.2 -38.5h0M155.4 -48.8h0M166.5 -91.6h0M164.1 -108.2h0M174.1 -195.2h0M183.3 -254.4h0M206.2 -283.1h0M234.8 -280.9h0M245.9 -272.8h0M242 -254.2h0M243 -254h0M258.8 -190.6h0M264.3 -184.3h0M257.4 -183.4h0M312.8 -275.9h0M341.8 -256.9h0M345.3 -191.2h0M343.5 -183.3h0M342 -87.9h0M352.5 -38.5h0"/></g></g></g></svg>';
/*LOGO-END*/

// ---------------------------------------------------------------------------------------------
// Icons (24-unit boxes)
// ---------------------------------------------------------------------------------------------
const I_PAUSE = '<path d="M7 4.5h3.2v15H7zM13.8 4.5H17v15h-3.2z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>';
const I_RESET = '<path d="M19.2 12.5a7.2 7.2 0 1 1-2.4-5.4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M20.6 3.6l-.4 6.4-6.2-1.6z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>';
const I_BOOST = '<path d="M13.6 1.8 4.2 13.4h6.4l-1.8 8.8 10.4-12.4h-6.6z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>';
const I_HAND = '<path d="M3.6 21h10" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M7.6 19.2 16.4 8.6" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><path d="m15 10.3 4.8-5.8" stroke="currentColor" stroke-width="5.6" stroke-linecap="round"/><circle cx="7.6" cy="19.2" r="2.6" fill="currentColor"/><path d="M3.8 13.6a9 9 0 0 1 4.6-7.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="m7.2 3.6 3.6 2-3.2 2.6z" fill="currentColor"/>';
const I_DPAD = '<path d="M9 2.5h6v6.5h6.5v6H15v6.5H9V15H2.5V9H9z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>';
const I_LEFT = '<path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>';
const I_RIGHT = '<path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>';
const icon = (body: string, cls = '') => `<svg class="dfm-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

// ---------------------------------------------------------------------------------------------
// Controls diagrams (SVG, 600 x 330 units, text in the UI font; sizes chosen to stay >= ~11 px on a phone)
// ---------------------------------------------------------------------------------------------
const textW = (s: string, fs: number) => [...s].reduce((w, c) => w + (c === ' ' ? 0.32 : c === 'I' ? 0.5 : 0.72), 0) * fs;

function chip(cx: number, cy: number, s: string, cls: string, fs = 18): string {
  const w = Math.round(textW(s, fs) + 24), h = fs + 13;
  return `<g class="c ${cls}"><rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${h / 2}"/><text x="${cx}" y="${cy + 1}" style="font-size:${fs}px">${s}</text></g>`;
}
function cap(x: number, y: number, w: number, inner: string, cls = ''): string {
  return `<g class="k ${cls}"><rect class="kl" x="${x}" y="${y + 5}" width="${w}" height="54" rx="10"/><rect class="kc" x="${x}" y="${y}" width="${w}" height="54" rx="10"/>${inner}</g>`;
}
const keycap = (x: number, y: number, w: number, s: string) =>
  cap(x, y, w, `<text class="kt" x="${x + w / 2}" y="${y + 28}" style="font-size:${s.length > 2 ? 16 : 22}px">${s}</text>`);
const arrowKey = (x: number, y: number, rot: number, letter: string, cls: string) =>
  cap(x, y, 54, `<path class="ka" d="M0 -6 7 4H-7z" transform="translate(${x + 27} ${y + 15}) rotate(${rot})"/><text class="kt" x="${x + 27}" y="${y + 38}" style="font-size:17px">${letter}</text>`, cls);
const label = (x: number, y: number, s: string, anchor = 'middle', cls = '') => `<text class="lb ${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${s}</text>`;
const lead = (d: string) => `<path class="ld-h" d="${d}"/><path class="ld" d="${d}"/>`;

const svgOpen = (cls: string, w: number, h: number, name: string) => `<svg class="dfm-dg ${cls}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${name} controls">`;

function keyboardDiagram(tall: boolean): string {
  const cx = tall ? 200 : 300;
  const cluster = chip(cx, 21, 'GAS', 'c-gas') +
    arrowKey(cx - 27, 42, 0, 'W', 'k-gas') +
    arrowKey(cx - 89, 104, -90, 'A', 'k-steer') + arrowKey(cx - 27, 104, 180, 'S', 'k-brake') + arrowKey(cx + 35, 104, 90, 'D', 'k-steer') +
    chip(cx - 145, 131, 'STEER', 'c-steer') + chip(cx + 145, 131, 'STEER', 'c-steer') +
    chip(cx, 188, 'BRAKE / REVERSE', 'c-brake');
  const esc = (x: number, y: number) => keycap(x, y, 66, 'ESC') + `<text class="lb" x="${x + 80}" y="${y + 34}" text-anchor="middle">/</text>` + keycap(x + 94, y, 54, 'P');
  if (tall) {
    return svgOpen('dfm-dg--tall', 400, 520, 'Keyboard') + `<g transform="translate(0 34)">` + cluster + `<path class="sep" d="M24 218H376"/>` +
      keycap(30, 238, 150, 'SPACE') + label(105, 324, 'HANDBRAKE') +
      keycap(245, 238, 100, 'SHIFT') + label(295, 324, 'BOOST') +
      keycap(78, 352, 54, 'R') + label(105, 438, 'RESET') +
      esc(248, 352) + label(305, 438, 'PAUSE') + `</g></svg>`;
  }
  return svgOpen('dfm-dg--wide', 600, 330, 'Keyboard') + cluster + `<path class="sep" d="M24 216H576"/>` +
    keycap(20, 230, 150, 'SPACE') + label(95, 318, 'HANDBRAKE') +
    keycap(200, 230, 100, 'SHIFT') + label(250, 318, 'BOOST') +
    keycap(338, 230, 54, 'R') + label(365, 318, 'RESET') +
    esc(428, 230) + label(503, 318, 'PAUSE') + `</svg>`;
}

function gamepadArt(): string {
  const body = 'M228 118H372C400 118 420 130 430 156L452 226C460 252 446 270 425 267C412 265 403 257 395 244L378 216H222L205 244C197 257 188 265 175 267C154 270 140 252 148 226L170 156C180 130 200 118 228 118Z';
  const btn = (x: number, y: number, l: string, cls: string) => `<g class="fb ${cls}"><circle cx="${x}" cy="${y}" r="11.5"/><text x="${x}" y="${y + 1}">${l}</text></g>`;
  return `<rect class="trg t-brake" x="204" y="86" width="52" height="40" rx="11"/><rect class="trg t-gas" x="344" y="86" width="52" height="40" rx="11"/>` +
    `<text class="tl" x="230" y="100">LT</text><text class="tl" x="370" y="100">RT</text>` +
    `<rect class="bmp" x="196" y="110" width="64" height="14" rx="7"/><rect class="bmp b-boost" x="340" y="110" width="64" height="14" rx="7"/>` +
    `<path class="pad-s" d="${body}" transform="translate(4 6)"/><path class="pad" d="${body}"/>` +
    `<g class="stk s-steer"><circle cx="238" cy="168" r="21"/><circle class="in" cx="238" cy="168" r="12"/></g>` +
    `<path class="dpad" d="M266 194h10v10h10v10h-10v10h-10v-10h-10v-10h10z"/>` +
    `<g class="stk"><circle cx="320" cy="212" r="17"/><circle class="in" cx="320" cy="212" r="9.5"/></g>` +
    `<rect class="mini" x="274" y="151" width="16" height="10" rx="5"/><rect class="mini m-pause" x="306" y="151" width="16" height="10" rx="5"/>` +
    btn(366, 145, 'Y', 'fb-y') + btn(344, 168, 'X', 'fb-x') + btn(388, 168, 'B', 'fb-b') + btn(366, 191, 'A', 'fb-a');
}

function gamepadDiagram(tall: boolean): string {
  if (tall) {
    // portrait: the pad on top, a glyph legend underneath (side callouts would not fit at this width)
    const row = (y: number, glyph: string, s: string) => `<g transform="translate(0 ${y})">${glyph}${label(150, 7, s, 'start')}</g>`;
    const pill = (x: number, l: string, cls: string) => `<g class="lg ${cls}"><rect x="${x - 22}" y="-12" width="44" height="24" rx="9"/><text class="tl" x="${x}" y="1">${l}</text></g>`;
    const dot = (x: number, l: string, cls: string) => `<g class="fb ${cls}"><circle cx="${x}" cy="0" r="12"/><text x="${x}" y="1">${l}</text></g>`;
    return svgOpen('dfm-dg--tall', 400, 520, 'Gamepad') + `<g transform="translate(0 25)">` +
      `<g transform="translate(-100 -78)">${gamepadArt()}</g>` +
      `<path class="sep" d="M24 214H376"/>` +
      row(244, pill(118, 'LT', 't-brake'), 'BRAKE / REVERSE') +
      row(280, pill(118, 'RT', 't-gas'), 'GAS') +
      row(316, `<g class="stk s-steer"><circle cx="118" cy="0" r="13"/><circle class="in" cx="118" cy="0" r="7"/></g>`, 'STEER') +
      row(352, dot(118, 'A', 'fb-a'), 'HANDBRAKE') +
      row(388, dot(70, 'X', 'fb-x') + `<text class="lb" x="91" y="7" text-anchor="middle">/</text>` + pill(118, 'RB', 'b-boost'), 'BOOST') +
      row(424, dot(118, 'Y', 'fb-y'), 'RESET') +
      row(460, `<rect class="mini m-pause" x="106" y="-7" width="24" height="14" rx="7"/>`, 'PAUSE') +
      `</g></svg>`;
  }
  const T = (x: number, y: number) => `${x} ${y}`;
  return svgOpen('dfm-dg--wide', 600, 330, 'Gamepad') + `<g transform="translate(0 20)">` + gamepadArt() +
    lead(`M${T(204, 100)}L144 94`) + label(138, 100, 'BRAKE', 'end') + label(138, 120, 'REVERSE', 'end', 'sm') +
    lead(`M${T(217, 168)}H144`) + label(138, 175, 'STEER', 'end') +
    lead(`M${T(396, 100)}L458 88`) + label(464, 95, 'GAS', 'start') +
    lead(`M${T(404, 117)}L458 120`) + label(464, 127, 'BOOST', 'start') +
    lead(`M${T(378, 145)}L458 152`) + label(464, 159, 'RESET', 'start') +
    lead(`M${T(378, 194)}L458 204`) + label(464, 211, 'HANDBRAKE', 'start') +
    lead(`M${T(344, 180)}V280`) + label(344, 302, 'BOOST') +
    lead(`M${T(314, 150)}V30`) + label(314, 20, 'PAUSE') +
    `</g></svg>`;
}

function touchDiagram(tall: boolean): string {
  const ico = (body: string, x: number, y: number, s: number) => `<g transform="translate(${x - s / 2} ${y - s / 2}) scale(${s / 24})">${body}</g>`;
  const ring = (x: number, y: number, r: number) => `<g class="ring"><circle cx="${x}" cy="${y}" r="${r}"/><circle class="kn" cx="${x}" cy="${y}" r="${r * 0.42}"/>` +
    `<g class="chev">${ico(I_LEFT, x - r * 0.74, y, r * 0.42)}${ico(I_RIGHT, x + r * 0.74, y, r * 0.42)}</g></g>`;
  const pedal = (x: number, y: number, w: number, h: number, cls: string, s: string, fs: number) =>
    `<g class="pd ${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="11"/><path class="rid" d="M${x + 12} ${y + 20}h${w - 24}M${x + 12} ${y + 33}h${w - 24}${h > 100 ? `M${x + 12} ${y + 46}h${w - 24}` : ''}"/>` +
    `<text x="${x + w / 2}" y="${y + h - 15}" style="font-size:${fs}px">${s}</text></g>`;
  const rb = (x: number, y: number, r: number, body: string, cls: string) => `<g class="rb ${cls}"><circle cx="${x}" cy="${y}" r="${r}"/><g class="ic">${ico(body, x, y, r * 1.05)}</g></g>`;
  if (tall) {
    return svgOpen('dfm-dg--tall t', 400, 520, 'Touch') +
      `<rect class="ph" x="62" y="6" width="276" height="508" rx="38"/><rect class="scr" x="76" y="22" width="248" height="476" rx="18"/>` +
      `<path class="zone" d="M94 22H200V498H94A18 18 0 0 1 76 480V40A18 18 0 0 1 94 22Z"/><path class="half" d="M200 34V486"/>` +
      ring(132, 424, 44) + label(132, 360, 'STEER') +
      pedal(264, 360, 46, 124, 'p-gas', 'GAS', 14) + pedal(212, 390, 46, 94, 'p-brake', 'BRAKE', 10.5) +
      rb(287, 316, 20, I_BOOST, 'r-boost') + rb(235, 346, 20, I_HAND, 'r-hand') +
      rb(258, 52, 14, I_RESET, 'r-sm') + rb(298, 52, 14, I_PAUSE, 'r-sm') +
      lead('M226 58 244 54') + label(220, 64, 'RESET', 'end') +
      lead('M226 96H298V66') + label(220, 102, 'PAUSE', 'end') +
      lead('M226 262 272 302') + label(220, 266, 'BOOST', 'end') +
      lead('M226 298 229 327') + label(220, 304, 'HANDBRAKE', 'end') +
      `</svg>`;
  }
  return svgOpen('dfm-dg--wide t', 600, 330, 'Touch') +
    `<rect class="ph" x="8" y="8" width="584" height="314" rx="38"/><rect class="scr" x="28" y="24" width="544" height="282" rx="16"/>` +
    `<path class="zone" d="M44 24H300V306H44A16 16 0 0 1 28 290V40A16 16 0 0 1 44 24Z"/><path class="half" d="M300 34V296"/>` +
    ring(140, 214, 54) + label(140, 128, 'STEER', 'middle', 'big') +
    pedal(498, 168, 56, 122, 'p-gas', 'GAS', 17) + pedal(432, 194, 56, 96, 'p-brake', 'BRAKE', 13) +
    rb(526, 132, 25, I_BOOST, 'r-boost') + rb(460, 154, 25, I_HAND, 'r-hand') +
    rb(494, 54, 17, I_RESET, 'r-sm') + rb(540, 54, 17, I_PAUSE, 'r-sm') +
    lead('M414 48H473') + label(408, 54, 'RESET', 'end') +
    lead('M414 84H540V75') + label(408, 90, 'PAUSE', 'end') +
    lead('M414 116 499 128') + label(408, 122, 'BOOST', 'end') +
    lead('M414 154H433') + label(408, 160, 'HANDBRAKE', 'end') +
    `</svg>`;
}

function bootRoad(): string {
  // neon stand-in for the road, drawn where the live road will appear when the card fades
  const hy = 470, H = 1000, cx = 500, half = 760;
  const r = (v: number) => Math.round(v * 10) / 10;
  const yAt = (z: number) => r(hy + (H - hy) / z), xAt = (z: number, lane: number) => r(cx + (lane * half) / z);
  let d = '', g = '';
  for (let i = 0; i < 16; i++) {
    const z0 = 0.9 + i * 1.5, z1 = z0 + 0.75;
    for (const lane of [-0.31, 0.31]) d += `M${xAt(z0, lane)} ${yAt(z0)}L${xAt(z1, lane)} ${yAt(z1)}`;
  }
  for (let i = 0; i < 9; i++) { const z = 1 + i * i * 0.5; g += `M${xAt(z, -1)} ${yAt(z)}L${xAt(z, 1)} ${yAt(z)}`; }
  return `<svg class="dfm-boot-road" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">` +
    `<path class="g" d="${g}"/><path class="e" d="M${cx} ${hy}L${cx - half} ${H}M${cx} ${hy}L${cx + half} ${H}"/><path class="d" d="${d}"/><path class="h" d="M0 ${hy}H1000"/></svg>`;
}

// ---------------------------------------------------------------------------------------------

function loadFonts(): void {
  if (typeof FontFace === 'undefined' || !document.fonts) return;
  const base = import.meta.env.BASE_URL;
  const faces: [string, string][] = [['DFM Bungee', 'ui/bungee.woff2'], ['DFM Dot', 'ui/dotgothic.woff2']];
  for (const [family, file] of faces) {
    try {
      const f = new FontFace(family, `url(${base}${file}) format('woff2')`, { display: 'block' });
      document.fonts.add(f);
      f.load().catch(() => { /* fall back to system faces */ });
    } catch { /* ignore */ }
  }
}

function readLevel(): GraphicsLevel {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && (LEVELS as readonly string[]).includes(v)) return v as GraphicsLevel;
  } catch { /* storage unavailable */ }
  return 'high';
}
function writeLevel(v: GraphicsLevel): void {
  try { localStorage.setItem(STORAGE_KEY, v); } catch { /* storage unavailable */ }
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const now = () => performance.now();

type Ctl = 'gas' | 'brake' | 'boost' | 'hand' | 'reset' | 'pause';

export class FrontEnd {
  onTouchPause?: () => void;
  readonly touch: TouchState = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, reset: false };

  private readonly h: FrontEndHandlers;
  private readonly el: HTMLDivElement;
  private readonly q = <T extends Element = HTMLElement>(sel: string) => this.el.querySelector(sel) as T;
  private _graphics: GraphicsLevel;
  private _paused = false;
  private bootUp = true;
  private titleUp = false;
  private controlsUp = false;
  private touchOn = false;
  private sel = 0;
  private tab = 0;
  private mode: InputMode = 'kbd';
  private titleReadyAt = 0;
  private pauseReadyAt = 0;
  // boost
  private bLevel = -1;
  private bBoosting = false;
  private bFull = false;
  // boot
  private bootP = -1;
  private bootLabel = '';
  // touch
  private steerId = -1;
  private steerX0 = 0;
  private steerR = 64;
  private readonly ctlPointers = new Map<number, Ctl | null>();
  private ctlRects: [Ctl, DOMRect][] = [];
  private hideTimers = new Map<HTMLElement, number>();

  // elements
  private readonly bootEl: HTMLElement;
  private readonly bootFill: HTMLElement;
  private readonly bootNeedle: HTMLElement;
  private readonly bootWhat: HTMLElement;
  private readonly bootPct: HTMLElement;
  private readonly logo: HTMLElement;
  private readonly title: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly ctl: HTMLElement;
  private readonly items: HTMLElement[];
  private readonly chips: HTMLElement[];
  private readonly tabs: HTMLElement[];
  private readonly panels: HTMLElement[];
  private readonly boostFill: HTMLElement;
  private readonly tipL: HTMLElement;
  private readonly tipR: HTMLElement;
  private readonly touchLayer: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly knob: HTMLElement;

  constructor(root: HTMLElement, handlers: FrontEndHandlers) {
    this.h = handlers;
    this._graphics = readLevel();
    loadFonts();
    const el = (this.el = document.createElement('div'));
    el.className = 'dfm dfm--boot';
    if (reducedMotion()) el.classList.add('dfm--still');
    el.innerHTML = this.markup();
    root.appendChild(el);

    this.bootEl = this.q('.dfm-boot');
    this.bootFill = this.q('.dfm-tuner-fill');
    this.bootNeedle = this.q('.dfm-tuner-needle');
    this.bootWhat = this.q('.dfm-boot-what');
    this.bootPct = this.q('.dfm-boot-pct');
    this.logo = this.q('.dfm-logo');
    this.title = this.q('.dfm-title');
    this.pause = this.q('.dfm-pause');
    this.ctl = this.q('.dfm-ctl');
    this.items = [...el.querySelectorAll<HTMLElement>('.dfm-item')];
    this.chips = [...el.querySelectorAll<HTMLElement>('.dfm-chip')];
    this.tabs = [...el.querySelectorAll<HTMLElement>('.dfm-tab')];
    this.panels = [...el.querySelectorAll<HTMLElement>('.dfm-panel')];
    this.boostFill = this.q('.dfm-boost-fill');
    this.tipL = this.q('.dfm-boost-tip--l');
    this.tipR = this.q('.dfm-boost-tip--r');
    this.touchLayer = this.q('.dfm-touch');
    this.ring = this.q('.dfm-ring');
    this.knob = this.q('.dfm-knob');

    for (const layer of [this.title, this.pause, this.ctl]) this.setShown(layer, false, 0);
    this.renderGraphics();
    this.renderSel();
    this.renderTab();
    this.syncLogo();
    this.boot_(0, '');
    this.bindInput();
  }

  // ---------------------------------------------------------------- public API
  get graphics(): GraphicsLevel { return this._graphics; }
  get paused(): boolean { return this._paused; }

  boot(progress: number, label: string): void { this.boot_(progress, label); }

  bootDone(): void {
    if (!this.bootUp) return;
    this.bootUp = false;
    this.el.classList.remove('dfm--boot');
    this.setShown(this.bootEl, false, 700);
    this.syncLogo();
  }

  showTitle(): void {
    if (this.titleUp) return;
    this.titleUp = true;
    this.titleReadyAt = now() + 450;
    this.el.classList.add('dfm--title');
    this.setShown(this.title, true);
    this.syncLogo();
  }

  hideTitle(): void {
    if (!this.titleUp) return;
    this.titleUp = false;
    this.el.classList.remove('dfm--title');
    this.setShown(this.title, false, 450);
    this.syncLogo();
  }

  showPause(): void {
    if (this._paused) return;
    this._paused = true;
    this.pauseReadyAt = now() + 120;
    this.sel = 0;
    this.renderSel();
    this.el.classList.add('dfm--pause');
    this.setShown(this.pause, true);
    this.releaseTouch();
  }

  hidePause(): void {
    if (!this._paused) return;
    this._paused = false;
    this.closeControls(true);
    this.el.classList.remove('dfm--pause');
    this.setShown(this.pause, false, 220);
  }

  menu(action: MenuAction): void {
    if (this.mode !== 'pad') this.setMode('pad');
    this.act(action);
  }

  setBoost(level: number, boosting: boolean): void {
    const l = level < 0 ? 0 : level > 1 ? 1 : level;
    if (Math.abs(l - this.bLevel) > 0.0015 || (l === 0) !== (this.bLevel === 0) || (l === 1) !== (this.bLevel === 1)) {
      this.bLevel = l;
      this.boostFill.style.transform = `scaleX(${l.toFixed(4)})`;
      this.tipL.style.transform = `translateX(${((1 - l) * 100).toFixed(3)}%)`;
      this.tipR.style.transform = `translateX(${(l * 100).toFixed(3)}%)`;
      const empty = l < 0.004;
      if (empty !== this.el.classList.contains('dfm--b-empty')) this.el.classList.toggle('dfm--b-empty', empty);
      const full = l > 0.997;
      if (full !== this.bFull) { this.bFull = full; this.el.classList.toggle('dfm--b-full', full); }
    }
    if (boosting !== this.bBoosting) {
      this.bBoosting = boosting;
      this.el.classList.toggle('dfm--boosting', boosting);
    }
  }

  setTouchVisible(v: boolean): void {
    if (v === this.touchOn) return;
    this.touchOn = v;
    this.el.classList.toggle('dfm--touch', v);
    if (!v) this.releaseTouch();
    if (v) this.setMode('touch');
  }

  // ---------------------------------------------------------------- markup
  private markup(): string {
    const ticks: string[] = [];
    for (let f = 76; f <= 95; f++) {
      const x = ((f - 76) / 19) * 190;
      const major = f % 4 === 0 || f === 95;
      ticks.push(`<path d="M${x} ${major ? 2 : 9}V20"${major ? ' class="mj"' : ''}/>`);
      for (let k = 1; k < 4 && f < 95; k++) ticks.push(`<path class="mn" d="M${x + k * 2.5} 14V20"/>`);
    }
    const nums = [76, 80, 84, 88, 92, 95].map((f) => `<span style="left:${(((f - 76) / 19) * 100).toFixed(2)}%">${f}</span>`).join('');
    const chips = LEVELS.map((l) => `<button class="dfm-chip" data-level="${l}" tabindex="-1" role="radio">${LEVEL_LABEL[l]}</button>`).join('');
    const tabs = TABS.map((t, i) => `<button class="dfm-tab" data-tab="${i}" tabindex="-1" role="tab">${t}</button>`).join('');
    const panels = [keyboardDiagram, gamepadDiagram, touchDiagram]
      .map((f) => f(false) + f(true))
      .map((svg, i) => `<section class="dfm-panel" data-tab="${i}" role="tabpanel"><h3 class="dfm-panel-h">${TABS[i]}</h3>${svg}</section>`).join('');
    return `
<div class="dfm-boot is-on" aria-label="Loading">
  <div class="dfm-boot-bg"></div>${bootRoad()}
  <div class="dfm-tuner" role="progressbar" aria-valuemin="0" aria-valuemax="100">
    <div class="dfm-tuner-nums">${nums}</div>
    <div class="dfm-tuner-scale">
      <svg class="dfm-tuner-ticks" viewBox="0 0 190 20" preserveAspectRatio="none" aria-hidden="true">${ticks.join('')}</svg>
      <div class="dfm-tuner-fill"></div>
      <div class="dfm-tuner-needle"><i></i></div>
    </div>
    <div class="dfm-boot-label"><span class="dfm-boot-what"></span><span class="dfm-boot-pct">0</span></div>
  </div>
</div>
<div class="dfm-title" aria-label="Title">
  <div class="dfm-press"><span>PRESS START</span></div>
</div>
<div class="dfm-logo" role="img" aria-label="DRIVE FM">
  <div class="dfm-logo-float">
    <div class="dfm-logo-drive">${LOGO_DRIVE}</div>
    <div class="dfm-logo-tag">${LOGO_TAG}</div>
    <i class="dfm-glint" style="left:10.3%;top:10.2%"></i><i class="dfm-glint dfm-glint--b" style="left:90.8%;top:8.3%"></i>
  </div>
</div>
<div class="dfm-boost" aria-hidden="true">
  <div class="dfm-boost-track"></div>
  <div class="dfm-boost-fill"><i></i></div>
  <div class="dfm-boost-tip dfm-boost-tip--l"><i></i></div>
  <div class="dfm-boost-tip dfm-boost-tip--r"><i></i></div>
</div>
<div class="dfm-touch" aria-hidden="true">
  <div class="dfm-steer"><div class="dfm-ring"><span class="dfm-chev dfm-chev--l">${icon(I_LEFT)}</span><span class="dfm-chev dfm-chev--r">${icon(I_RIGHT)}</span><div class="dfm-knob"></div></div></div>
  <div class="dfm-tbtns">
    <button class="dfm-tb dfm-tb--sm" data-ctl="reset" tabindex="-1" aria-label="Reset">${icon(I_RESET)}</button>
    <button class="dfm-tb dfm-tb--sm" data-ctl="pause" tabindex="-1" aria-label="Pause">${icon(I_PAUSE)}</button>
  </div>
  <div class="dfm-pedals">
    <div class="dfm-rbtn-col"><button class="dfm-tb dfm-tb--round dfm-tb--hand" data-ctl="hand" tabindex="-1" aria-label="Handbrake">${icon(I_HAND)}</button><span class="dfm-cap">HANDBRAKE</span>
      <button class="dfm-tb dfm-pedal dfm-pedal--brake" data-ctl="brake" tabindex="-1" aria-label="Brake"><i class="dfm-ridges"></i><span>BRAKE</span></button></div>
    <div class="dfm-rbtn-col"><button class="dfm-tb dfm-tb--round dfm-tb--boost" data-ctl="boost" tabindex="-1" aria-label="Boost">${icon(I_BOOST)}</button><span class="dfm-cap">BOOST</span>
      <button class="dfm-tb dfm-pedal dfm-pedal--gas" data-ctl="gas" tabindex="-1" aria-label="Gas"><i class="dfm-ridges"></i><span>GAS</span></button></div>
  </div>
</div>
<div class="dfm-pause" role="dialog" aria-label="Paused">
  <div class="dfm-pause-bg"></div>
  <div class="dfm-pause-main">
    <div class="dfm-pause-head"><span>PAUSE</span></div>
    <div class="dfm-menu" role="menu">
      <button class="dfm-item" data-i="0" tabindex="-1" role="menuitem"><span class="dfm-item-l">RESUME</span></button>
      <div class="dfm-item dfm-item--gfx" data-i="1" role="menuitem">
        <span class="dfm-item-l">GRAPHICS</span>
        <span class="dfm-seg" role="radiogroup" aria-label="Graphics">
          <button class="dfm-arrow" data-dir="-1" tabindex="-1" aria-label="Previous">${icon(I_LEFT)}</button>${chips}<button class="dfm-arrow" data-dir="1" tabindex="-1" aria-label="Next">${icon(I_RIGHT)}</button>
        </span>
      </div>
      <button class="dfm-item" data-i="2" tabindex="-1" role="menuitem"><span class="dfm-item-l">CONTROLS</span></button>
    </div>
    <div class="dfm-hints dfm-hints--kbd"><span><b>↑</b><b>↓</b>SELECT</span><span><b>←</b><b>→</b>CHANGE</span><span><b class="w">ENTER</b>OK</span><span><b class="w">ESC</b>RESUME</span></div>
    <div class="dfm-hints dfm-hints--pad"><span><b class="dp">${icon(I_DPAD)}</b>SELECT</span><span><b class="o a">A</b>OK</span><span><b class="o b">B</b>BACK</span></div>
  </div>
  <div class="dfm-ctl" role="dialog" aria-label="Controls">
    <div class="dfm-ctl-card">
      <div class="dfm-ctl-head"><span>CONTROLS</span></div>
      <div class="dfm-tabs" role="tablist">${tabs}</div>
      <div class="dfm-panels">${panels}</div>
      <button class="dfm-back" tabindex="-1">${icon(I_LEFT)}<span>BACK</span></button>
    </div>
  </div>
</div>`;
  }

  // ---------------------------------------------------------------- state helpers
  private setShown(layer: HTMLElement, on: boolean, hideMs = 0): void {
    const t = this.hideTimers.get(layer);
    if (t !== undefined) { clearTimeout(t); this.hideTimers.delete(layer); }
    layer.inert = !on;
    layer.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on) {
      layer.classList.remove('is-gone');
      // next frame so the transition runs from the hidden state
      void layer.offsetWidth;
      layer.classList.add('is-on');
    } else {
      layer.classList.remove('is-on');
      if (hideMs <= 0) layer.classList.add('is-gone');
      else this.hideTimers.set(layer, window.setTimeout(() => { layer.classList.add('is-gone'); this.hideTimers.delete(layer); }, hideMs));
    }
  }

  private syncLogo(): void {
    this.logo.classList.toggle('is-on', this.bootUp || this.titleUp);
  }

  private boot_(progress: number, label: string): void {
    const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    if (p !== this.bootP) {
      this.bootP = p;
      this.bootFill.style.transform = `scaleX(${p.toFixed(4)})`;
      this.bootNeedle.style.transform = `translateX(${(p * 100).toFixed(3)}%)`;
      const pct = String(Math.round(p * 100));
      if (this.bootPct.textContent !== pct) this.bootPct.textContent = pct;
      this.q('.dfm-tuner').setAttribute('aria-valuenow', pct);
    }
    const l = (label || '').toUpperCase();
    if (l !== this.bootLabel) { this.bootLabel = l; this.bootWhat.textContent = l; }
  }

  private setMode(m: InputMode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.el.dataset.input = m;
  }

  private renderGraphics(): void {
    for (const c of this.chips) {
      const on = c.dataset.level === this._graphics;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  private renderSel(): void {
    this.items.forEach((it, i) => it.classList.toggle('is-sel', i === this.sel));
  }

  private renderTab(): void {
    this.tabs.forEach((t, i) => { t.classList.toggle('is-on', i === this.tab); t.setAttribute('aria-selected', i === this.tab ? 'true' : 'false'); });
    this.panels.forEach((p, i) => p.classList.toggle('is-on', i === this.tab));
  }

  private setGraphics(l: GraphicsLevel): void {
    if (l === this._graphics) return;
    this._graphics = l;
    writeLevel(l);
    this.renderGraphics();
    this.h.graphics(l);
  }

  private cycleGraphics(dir: number): void {
    const i = LEVELS.indexOf(this._graphics);
    this.setGraphics(LEVELS[(i + dir + LEVELS.length) % LEVELS.length]);
    const seg = this.q('.dfm-seg');
    seg.classList.remove('is-bump');
    void seg.offsetWidth;
    seg.classList.add('is-bump');
  }

  private openControls(): void {
    if (this.controlsUp) return;
    this.controlsUp = true;
    this.tab = this.mode === 'pad' ? 1 : this.mode === 'touch' ? 2 : 0;
    this.renderTab();
    this.el.classList.add('dfm--controls');
    this.setShown(this.ctl, true);
  }

  private closeControls(immediate = false): void {
    if (!this.controlsUp) return;
    this.controlsUp = false;
    this.el.classList.remove('dfm--controls');
    this.setShown(this.ctl, false, immediate ? 0 : 200);
  }

  private doStart(): void {
    if (!this.titleUp || now() < this.titleReadyAt) return;
    this.hideTitle();
    this.h.start();
  }

  private doResume(): void {
    if (!this._paused) return;
    this.hidePause();
    this.h.resume();
  }

  private activate(i: number): void {
    const item = ITEMS[i];
    if (item === 'resume') this.doResume();
    else if (item === 'graphics') this.cycleGraphics(1);
    else this.openControls();
  }

  private act(a: MenuAction): void {
    if (this.titleUp && !this._paused) {
      if (a === 'confirm' || a === 'back') this.doStart();
      return;
    }
    if (!this._paused || now() < this.pauseReadyAt) return;
    if (this.controlsUp) {
      if (a === 'back' || a === 'confirm') this.closeControls();
      else if (a === 'left' || a === 'right') { this.tab = (this.tab + (a === 'left' ? -1 : 1) + TABS.length) % TABS.length; this.renderTab(); }
      return;
    }
    switch (a) {
      case 'up': this.sel = (this.sel + ITEMS.length - 1) % ITEMS.length; this.renderSel(); break;
      case 'down': this.sel = (this.sel + 1) % ITEMS.length; this.renderSel(); break;
      case 'left': case 'right':
        if (ITEMS[this.sel] === 'graphics') this.cycleGraphics(a === 'left' ? -1 : 1);
        break;
      case 'confirm': this.activate(this.sel); break;
      case 'back': this.doResume(); break;
    }
  }

  // ---------------------------------------------------------------- input binding
  private bindInput(): void {
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    // first touch shows the touch controls (captured before anything else sees it)
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.setTouchVisible(true);
      else if (e.pointerType === 'mouse' && this.mode === 'pad') this.setMode('kbd');
    }, true);
    // keep focus off our buttons so Space/Enter never "click" a hidden control
    this.el.addEventListener('mousedown', (e) => e.preventDefault());

    // title: any click / tap
    this.title.addEventListener('click', () => this.doStart());

    // pause menu
    this.items.forEach((it, i) => {
      it.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !this.controlsUp) { this.sel = i; this.renderSel(); } });
      it.addEventListener('click', (e) => {
        if (now() < this.pauseReadyAt || this.controlsUp) return;
        const t = e.target as HTMLElement;
        this.sel = i; this.renderSel();
        const chipEl = t.closest<HTMLElement>('.dfm-chip');
        const arrowEl = t.closest<HTMLElement>('.dfm-arrow');
        if (chipEl) this.setGraphics(chipEl.dataset.level as GraphicsLevel);
        else if (arrowEl) this.cycleGraphics(Number(arrowEl.dataset.dir));
        else this.activate(i);
      });
    });
    this.tabs.forEach((t, i) => t.addEventListener('click', () => { this.tab = i; this.renderTab(); }));
    this.q('.dfm-back').addEventListener('click', () => this.closeControls());
    this.ctl.addEventListener('click', (e) => { if (e.target === this.ctl) this.closeControls(); });

    // touch controls
    const steer = this.q('.dfm-steer');
    steer.addEventListener('pointerdown', (e) => this.steerDown(e));
    steer.addEventListener('pointermove', (e) => this.steerMove(e));
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) steer.addEventListener(ev, (e) => this.steerUp(e));
    const pads = [this.q('.dfm-pedals'), this.q('.dfm-tbtns')];
    for (const p of pads) {
      p.addEventListener('pointerdown', (e) => this.ctlDown(e));
      p.addEventListener('pointermove', (e) => this.ctlMove(e));
      for (const ev of ['pointerup', 'pointercancel'] as const) p.addEventListener(ev, (e) => this.ctlUp(e));
    }
    this.touchLayer.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.releaseTouch());
  }

  private onKey(e: KeyboardEvent): void {
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    const k = e.key;
    const modifier = k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'OS' || k === 'AltGraph' || k === 'CapsLock' || k === 'Tab' || /^F\d{1,2}$/.test(k);
    if (this.touchOn && !modifier) this.setTouchVisible(false);
    if (this.mode !== 'kbd') this.setMode('kbd');
    if (this.bootUp && !this.titleUp) return;
    if (this.titleUp && !this._paused) {
      if (modifier && k !== 'Shift') return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.doStart();
      return;
    }
    if (!this._paused) return;
    let a: MenuAction | null = null;
    switch (k) {
      case 'ArrowUp': case 'w': case 'W': a = 'up'; break;
      case 'ArrowDown': case 's': case 'S': a = 'down'; break;
      case 'ArrowLeft': case 'a': case 'A': a = 'left'; break;
      case 'ArrowRight': case 'd': case 'D': a = 'right'; break;
      case 'Enter': case ' ': a = 'confirm'; break;
      case 'Escape': case 'Backspace': case 'p': case 'P': a = 'back'; break;
    }
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat && (a === 'confirm' || a === 'back')) return;
    this.act(a);
  }

  // ---- steering pad: the ring re-centres on the touch-down point; steer = horizontal offset / radius
  private steerDown(e: PointerEvent): void {
    if (this.steerId !== -1 || e.button > 0) return;
    e.preventDefault();
    this.steerId = e.pointerId;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    const r = this.ring.getBoundingClientRect();
    this.steerR = r.width * 0.5;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const base = this.ring.dataset;
    const ox = Number(base.ox || 0), oy = Number(base.oy || 0);
    // move the ring so its centre is under the finger (clamped to stay on screen)
    const nx = Math.max(this.steerR + 8, Math.min(window.innerWidth / 2 - this.steerR, e.clientX));
    const ny = Math.max(this.steerR + 8, Math.min(window.innerHeight - this.steerR - 8, e.clientY));
    const dx = ox + nx - cx, dy = oy + ny - cy;
    base.ox = String(dx); base.oy = String(dy);
    this.ring.style.transform = `translate3d(${dx}px,${dy}px,0)`;
    this.steerX0 = nx;
    this.ring.classList.add('is-on');
    this.steerSet(e.clientX - nx);
  }
  private steerMove(e: PointerEvent): void {
    if (e.pointerId !== this.steerId) return;
    this.steerSet(e.clientX - this.steerX0);
  }
  private steerUp(e: PointerEvent): void {
    if (e.pointerId !== this.steerId) return;
    this.steerId = -1;
    this.ring.classList.remove('is-on');
    this.ring.dataset.ox = '0'; this.ring.dataset.oy = '0';
    this.ring.style.transform = '';
    this.steerSet(0);
  }
  private steerSet(dx: number): void {
    const s = Math.max(-1, Math.min(1, dx / (this.steerR * 0.9)));
    this.touch.steer = Math.abs(s) < 0.06 ? 0 : s;
    this.knob.style.transform = `translate3d(${(s * this.steerR * 0.62).toFixed(1)}px,0,0)`;
  }

  // ---- buttons and pedals: each pointer drives the control under it, so a thumb can slide gas <-> brake
  private ctlDown(e: PointerEvent): void {
    if (e.button > 0) return;
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    this.ctlRects = [...this.touchLayer.querySelectorAll<HTMLElement>('[data-ctl]')].map((b) => [b.dataset.ctl as Ctl, b.getBoundingClientRect()]);
    const c = this.hit(e.clientX, e.clientY);
    this.ctlPointers.set(e.pointerId, c);
    if (c === 'pause') { this.onTouchPause?.(); }
    this.syncCtl();
  }
  private ctlMove(e: PointerEvent): void {
    if (!this.ctlPointers.has(e.pointerId)) return;
    const prev = this.ctlPointers.get(e.pointerId) ?? null;
    if (prev === 'pause' || prev === 'reset') return;
    const c = this.hit(e.clientX, e.clientY);
    if (c === 'pause' || c === 'reset') return;
    if (c !== prev) { this.ctlPointers.set(e.pointerId, c); this.syncCtl(); }
  }
  private ctlUp(e: PointerEvent): void {
    if (!this.ctlPointers.delete(e.pointerId)) return;
    this.syncCtl();
  }
  private hit(x: number, y: number): Ctl | null {
    const pad = 6;
    for (const [c, r] of this.ctlRects) if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return c;
    return null;
  }
  private syncCtl(): void {
    const on = new Set(this.ctlPointers.values());
    const t = this.touch;
    t.throttle = on.has('gas') ? 1 : 0;
    t.brake = on.has('brake') ? 1 : 0;
    t.boost = on.has('boost');
    t.handbrake = on.has('hand');
    t.reset = on.has('reset');
    for (const b of this.touchLayer.querySelectorAll<HTMLElement>('[data-ctl]')) {
      const a = on.has(b.dataset.ctl as Ctl);
      if (a !== b.classList.contains('is-on')) b.classList.toggle('is-on', a);
    }
  }
  private releaseTouch(): void {
    this.ctlPointers.clear();
    this.syncCtl();
    if (this.steerId !== -1) this.steerUp({ pointerId: this.steerId } as PointerEvent);
  }
}
