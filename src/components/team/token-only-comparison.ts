import type { TeamComparison } from '../../core/trace-types.js';

/** Shared presentation policy for both Team comparison entry points; never mutate API evidence. */
export function tokenOnlyTeamComparison(source: TeamComparison): TeamComparison {
  const monetary = /(?:totalCostUsd|costGini|costCurrency|\b(?:cost|prices?|pricing|currency|fees?|spend|spent|USD|CNY|EUR|dollars?|cheaper|expensive|billing|charged)\b|[$¥￥€£]|成本|费用|金额|币种|单价|更贵|便宜|省钱|花费|收费)/i;
  const statements = (items: string[]): string[] => items.filter(item => !monetary.test(item));
  return {
    ...source,
    dimensions: source.dimensions.map(dimension => ({
      ...dimension,
      rows: dimension.rows.filter(row => row.metricId !== 'totalCostUsd' && row.metricId !== 'costGini'),
    })),
    strengths: statements(source.strengths),
    weaknesses: statements(source.weaknesses),
    tradeoffs: statements(source.tradeoffs),
    caveats: statements(source.caveats),
  };
}
