export const AUTH_TOKEN_STORAGE_KEY = 'auth-token';

export const AUTH_ERROR_MESSAGES = {
  authStatusCheckFailed: '无法验证身份状态',
  loginFailed: '登录失败',
  registrationFailed: '注册失败',
  networkError: '网络错误，请重试。',
  sessionExpired: '会话已过期，请重新登录。',
} as const;
