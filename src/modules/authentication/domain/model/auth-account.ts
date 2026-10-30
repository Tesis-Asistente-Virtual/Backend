export type AuthAccount = { id: string; email: string };
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
