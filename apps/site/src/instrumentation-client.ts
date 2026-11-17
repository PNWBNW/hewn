// The first of the site's own code to run in the browser: Next.js runs this file after the page's
// HTML has loaded and before it hydrates the page. The stylesheet keeps the page hidden until this
// shows it, and it shows it only as the top page, never inside someone else's frame (the top-page
// guard, `@pnw/security/frame_guard`, docs/THREAT_MODEL.md T3; why the site has it too:
// apps/site/README.md).
import { guardTopPage } from "@pnw/security/frame_guard";

guardTopPage(window, document.documentElement);
