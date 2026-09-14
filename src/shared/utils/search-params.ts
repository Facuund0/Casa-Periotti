/**
 * Un mismo parámetro puede venir repetido en la query string
 * ("?status=a&status=b"), y entonces Next lo entrega como array. Los
 * filtros del panel son de un solo valor: se toma el primero y se
 * descartan los vacíos, para que "?q=" no cuente como una búsqueda.
 */
export function firstParam(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  return single && single.length > 0 ? single : undefined;
}
