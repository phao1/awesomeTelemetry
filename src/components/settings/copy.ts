import type { Locale } from '../../i18n.js';
export function settingsCopy(locale:Locale) {
 const zh=locale==='zh';
 return {
  sections:[['general',zh?'常规':'General'],['appearance',zh?'外观':'Appearance'],['health',zh?'健康监测':'Health monitoring'],['alert-thresholds',zh?'告警阈值':'Alert thresholds'],['storage',zh?'数据与存储':'Data & storage'],['about',zh?'关于':'About']] as const,
  navigation:zh?'设置分类':'Settings sections',description:zh?'管理本机偏好、数据来源和告警规则。':'Manage local preferences, data sources and alert rules.',
  unsaved:zh?'有未保存的修改':'You have unsaved changes',discard:zh?'放弃':'Discard',save:zh?'保存':'Save',
  theme:zh?'主题':'Theme',themeHint:zh?'选择配色，或跟随系统外观。':'Choose a color theme or follow your system.',
  language:zh?'语言':'Language',languageHint:zh?'界面文案立即切换。':'Interface language changes immediately.',
  font:zh?'界面字号':'Interface text size',fontHint:zh?'与侧栏“显示”菜单保持同步。':'Shared with the sidebar Display menu.',
  enabledHint:zh?'启用后，本地监测可读取此工具的日志。':'Allow local monitoring to read this provider’s logs.',
  pathHint:zh?'设置日志目录或数据库文件的位置。':'Location of the log directory or database file.',
  alertsHint:zh?'留空即关闭；仅在超过阈值时标记。':'Leave blank to disable; mark only values above the limit.',
 };
}
