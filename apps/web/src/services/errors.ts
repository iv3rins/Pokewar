const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  IDENTITY_REQUIRED: '访客身份已失效，请重新设置昵称。',
  INVALID_NICKNAME: '昵称不能为空，且最多 40 个字符。',
  SESSION_FAILED: '无法建立访客身份，请稍后重试。',
  ROOM_NOT_FOUND: '未找到该房间，请检查房间码。',
  ROOM_FULL: '房间人数已满。',
  ROOM_ALREADY_STARTED: '该房间已经开始对局。',
  ALREADY_IN_ROOM: '你已经在该房间中。',
  PLAYER_BANNED: '暂时无法重新加入该房间。',
  NOT_ROOM_HOST: '只有房主可以执行此操作。',
  NOT_ALL_READY: '仍有玩家未准备。',
  INVALID_PLAYER_COUNT: '至少需要两名玩家才能开局。',
  READ_ONLY_CONNECTION: '另一个标签页已取得控制权。',
  REQUEST_TIMEOUT: '服务器响应超时，请重试。',
  INVALID_SERVER_PAYLOAD: '服务器数据未通过协议校验。',
  INVALID_PAYLOAD: '提交的数据格式无效。',
  LOGIN_NAME_TAKEN: '该登录用户名已被使用。',
  IDENTITY_ALREADY_REGISTERED: '当前访客身份已经注册。',
  GUEST_IDENTITY_REQUIRED: '请先建立访客身份再注册。',
  INVALID_CREDENTIALS: '用户名或密码错误。',
  LOGIN_RATE_LIMITED: '登录失败次数过多，请 15 分钟后重试。',
};

export function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? `操作失败（${code}）`;
}
