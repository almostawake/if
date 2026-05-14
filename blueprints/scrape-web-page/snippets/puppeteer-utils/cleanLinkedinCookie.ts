import { Cookie } from "puppeteer";

export function cleanLinkedInCookies(cookies: Cookie[]): Cookie[] {
    return cookies.map((cookie) => {
        if (cookie.sameSite === null) {
            cookie.sameSite = "None";  // LinkedIn requires explicit "None" instead of null
        } else if (cookie.sameSite?.toLowerCase() === "lax") {
            cookie.sameSite = "Lax";   // Normalize to proper case "Lax"
        } else if (cookie.sameSite?.toLowerCase() === "no_restriction") {
            cookie.sameSite = "None";  // Convert LinkedIn's "no_restriction" to standard "None"
        }
        return cookie;
    });
}
