const forbiddenClinicalField = /^(rawscore|equivalentscore|score|scores|scoringversion|category|categories|dimension|dimensions|diagnosis|diagnoses|diagnostic|diagnosticresult|clinicaldiagnosis|clinicalresult|isdiagnostic|severity|clinicalseverity|risk|risklevel|riskscore|probability|percentage|dass21|dass21result|dass21score)$/i;

/** Recursively reports score/diagnosis-shaped property names without scanning warning text. */
export function findClinicalResultFieldPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findClinicalResultFieldPaths(item, `${path}[${index}]`));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) => [
    ...(forbiddenClinicalField.test(key.replace(/[_-]/g, '')) ? [`${path}.${key}`] : []),
    ...findClinicalResultFieldPaths(nested, `${path}.${key}`),
  ]);
}
