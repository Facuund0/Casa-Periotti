/**
 * Convierte un nombre en un slug apto para URL: minúsculas, sin
 * acentos, con guiones. Es lo que se usa cuando el empleado carga una
 * categoría y no completa el slug a mano.
 *
 * La acentuación se saca con normalize("NFD"), que separa cada letra
 * de su signo diacrítico, y después se borran esos signos (el rango
 * U+0300–U+036F). Así "Sanitarios y Bañeras" queda
 * "sanitarios-y-baneras" y no "sanitarios-y-ba-eras".
 *
 * El rango va escrito con escapes y no con los caracteres literales a
 * propósito: son marcas combinantes invisibles, y en el código fuente
 * cualquier editor las puede arruinar sin que se note.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
