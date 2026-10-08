export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode('hotel-decision-salt::' + password);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const h = await hashPassword(password);
  return h === hash;
}

// Default teacher password used when no custom hash is set in the DB.
export const TEACHER_DEFAULT_PASSWORD = 'teacher2024';

/**
 * The teacher password typed at login, held **in memory only** for the
 * lifetime of the page. It is the credential the teacher-facing RPCs ask for
 * (currently `list_group_passwords`) and it is deliberately never written to
 * localStorage/sessionStorage: after a reload the teacher is asked for it
 * again instead of leaving a usable credential lying on the device.
 */
let teacherSecret = '';

export function setTeacherSecret(password: string): void {
  teacherSecret = password;
}

export function getTeacherSecret(): string {
  return teacherSecret;
}

export function clearTeacherSecret(): void {
  teacherSecret = '';
}

/**
 * Verify a teacher login attempt.
 * If storedHash is empty, compare against the default plaintext password.
 * Otherwise verify against the stored hash.
 */
export async function verifyTeacherPassword(
  input: string,
  storedHash: string,
): Promise<boolean> {
  if (!storedHash) {
    return input === TEACHER_DEFAULT_PASSWORD;
  }
  return verifyPassword(input, storedHash);
}
