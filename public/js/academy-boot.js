/* VooSquare Academy website: runs in <head> before the page paints (a file, because the Content Security Policy allows no
 * inline scripts). On /login and /signup the page renders as the sign-in page without a flash of the landing. */
document.documentElement.classList.add('va-js');
if (/^\/(login|signup)\/?$/.test(location.pathname)) document.documentElement.classList.add('va-auth-view');
