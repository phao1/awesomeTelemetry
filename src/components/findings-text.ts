import type { I18nKey, Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { Finding } from '../core/session-findings.js';
import { fmtDur } from '../core/session-findings.js';

function replace(source: string, values: Record<string, unknown>): string {
  let out = source;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{${key}}`, String(value));
  }
  return out;
}

/** ui-design-v2 §3.1：Finding 文案（判断句 + 数字），zh/en 共用模板。 */
export function formatFindingTitle(finding: Finding, locale: Locale): string {
  const d = finding.data;
  switch (finding.kind) {
    case 'phaseDominant':
      return replace(t('findings.phaseDominant', locale), {
        phase: t(`phase.${d.phase}` as I18nKey, locale),
        pct: d.pct,
      });
    case 'longEvent':
      return replace(t('findings.longEvent', locale), { dur: fmtDur(Number(d.durMs)), pct: d.pct });
    case 'repairLoop':
      return replace(t('findings.repairLoop', locale), { rounds: d.rounds });
    case 'blindWrite':
      return replace(t('findings.blindWrite', locale), { n: d.count });
    case 'noVerify':
      return t('findings.noVerify', locale);
    case 'toolFail':
      return replace(t('findings.toolFail', locale), { tool: d.tool, pct: d.pct });
    case 'sysPromptRepeat':
      return replace(t('findings.sysPromptRepeat', locale), { pct: d.pct });
    case 'idleHigh':
      return replace(t('findings.idleHigh', locale), { pct: d.pct });
    case 'ttft':
      return replace(t('findings.ttft', locale), { dur: fmtDur(Number(d.durMs)) });
    case 'manyInterventions':
      return replace(t('findings.manyInterventions', locale), { n: d.count });
  }
}

export function formatFindingDetail(finding: Finding, locale: Locale): string {
  const d = finding.data;
  switch (finding.kind) {
    case 'phaseDominant':
      return replace(t('findings.phaseDominantDetail', locale), {
        dur: fmtDur(Number(d.durMs)),
        total: fmtDur(Number(d.totalMs)),
        n: d.count,
      });
    case 'longEvent':
      return replace(t('findings.longEventDetail', locale), {
        title: String(d.title).length > 24 ? `${String(d.title).slice(0, 24)}…` : d.title,
      });
    case 'repairLoop':
      return replace(t('findings.repairLoopDetail', locale), { groups: d.groups, steps: d.steps });
    case 'blindWrite':
      return replace(t('findings.blindWriteDetail', locale), {
        files: Array.isArray(d.files) ? (d.files as string[]).join('、') : String(d.files),
        n: d.count,
      });
    case 'noVerify':
      return t('findings.noVerifyDetail', locale);
    case 'toolFail':
      return replace(t('findings.toolFailDetail', locale), { fails: d.fails, calls: d.calls });
    case 'sysPromptRepeat':
      return replace(t('findings.sysPromptRepeatDetail', locale), { n: d.sends });
    case 'idleHigh':
      return replace(t('findings.idleHighDetail', locale), { dur: fmtDur(Number(d.durMs)) });
    case 'ttft':
      return t('findings.ttftDetail', locale);
    case 'manyInterventions':
      return t('findings.manyInterventionsDetail', locale);
  }
}
