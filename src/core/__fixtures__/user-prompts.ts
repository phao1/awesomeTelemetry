/** Synthetic reproduction of the coordinator's d01f 15-message sequence; no captured bodies. */
export const D01F_USER_MESSAGES = [
  '# AGENTS.md instructions for /Users/example/project\n<INSTRUCTIONS>rules</INSTRUCTIONS>',
  '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>',
  '帮我拉取最新的代码\n先看一下变更',
  '为啥要说明这个问题？',
  '更新到github仓库了是吧',
  '为什么会出现 窗口已过期？',
  '<send_user_message_question_reply>桌面版</send_user_message_question_reply>',
  '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>',
  '重启应用也没办法解决',
  '我本地也出现这个问题了，帮我看看',
  '我现在开的 这个 deepseek harenss的桌面版',
  '<send_user_message_question_reply>确定</send_user_message_question_reply>',
  '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>',
  '那帮我发布 npm 新版本\npassword=NEVER_IN_TITLE',
  '<send_user_message_question_reply>可以发布</send_user_message_question_reply>',
] as const;
export const D01F_QUESTION_POSITIONS = [3,4,5,6,9,10,11,14];
