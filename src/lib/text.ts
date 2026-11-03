/** Minúsculas, sem acentos, espaços colapsados — para comparar e pesquisar nomes. */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Iniciais para avatar/miniatura (ignora "de", "da"… e o prefixo "Chaveiro"). */
export function initials(name: string): string {
  const words = name
    .replace(/[—–-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^(de|da|do|das|dos|e)$/i.test(w));
  const picked = words.length > 1 && /^chaveiros?$/i.test(words[0]!) ? words.slice(1) : words;
  if (picked.length === 1) return picked[0]!.slice(0, 2).toUpperCase();
  return (picked.slice(0, 2).map((w) => w.charAt(0)).join('') || name.slice(0, 2)).toUpperCase();
}
