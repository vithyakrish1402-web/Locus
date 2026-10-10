/** Up to two initials, from the first two words of a name ("Meera Iyer" -> "MI"). */
export function initialsOf(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => [...word][0].toUpperCase()).join('') || '?';
}
