/* Runs before the page paints (in <head>, no defer): marks the login page so it renders without a flash of the site.
 * Kept as a file because the Content Security Policy allows no inline scripts. */
if (location.pathname.replace(/\/+$/, '') === '/login') document.documentElement.classList.add('html-login');
