/*
 * Get a specific cookie by name
 */
export const getCookie = (name: string): string | undefined => {
  return document.cookie.split('; ').find((row: string) => row.startsWith(name));
};

/*
 * Get the value of a specific cookie by name
 */
export const getCookieValue = (name: string): string | undefined => {
  const cookiesPresent = getCookie(name);
  return cookiesPresent?.split('=')[1];
};
