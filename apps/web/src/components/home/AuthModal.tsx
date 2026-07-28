import {
  NAME_NOUNS,
  NAME_PREFIXES,
  type LoginAccountInput,
  type NameNoun,
  type NamePrefix,
  type RegisterAccountInput,
} from '@pokewar/protocol';
import { LockKeyhole, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';

export function AuthModal({
  open,
  busy,
  error,
  onClose,
  onRegister,
  onLogin,
}: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onRegister: (input: RegisterAccountInput) => void;
  readonly onLogin: (input: LoginAccountInput) => void;
}) {
  const [tab, setTab] = useState<'register' | 'login'>('register');
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [prefix, setPrefix] = useState<NamePrefix>(NAME_PREFIXES[0]);
  const [noun, setNoun] = useState<NameNoun>(NAME_NOUNS[0]);
  if (!open) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (tab === 'register') onRegister({ loginName, password, prefix, noun });
    else onLogin({ loginName, password });
  };
  return (
    <div
      className="overlay auth-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="close-button" type="button" aria-label="关闭账号窗口" onClick={onClose}>
          <X size={21} />
        </button>
        <LockKeyhole size={30} aria-hidden="true" />
        <span>ACCOUNT ACCESS</span>
        <h2 id="auth-title">注册与登录</h2>
        <div className="auth-tabs" role="tablist" aria-label="账号操作">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'register'}
            onClick={() => setTab('register')}
          >
            注册
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'login'}
            onClick={() => setTab('login')}
          >
            登录
          </button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="login-name">登录用户名</label>
          <input
            id="login-name"
            value={loginName}
            minLength={4}
            maxLength={24}
            pattern="[A-Za-z0-9_]+"
            autoComplete="username"
            required
            onChange={(event) => setLoginName(event.target.value)}
          />
          <small>4–24 位字母、数字或下划线，不会公开显示。</small>
          <label htmlFor="account-password">密码</label>
          <input
            id="account-password"
            type="password"
            value={password}
            minLength={8}
            maxLength={72}
            autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
            required
            onChange={(event) => setPassword(event.target.value)}
          />
          <small>至少 8 位，并同时包含字母和数字。</small>
          {tab === 'register' ? (
            <>
              <div className="name-selects">
                <label>
                  公开昵称前缀
                  <select
                    value={prefix}
                    onChange={(event) => setPrefix(event.target.value as NamePrefix)}
                  >
                    {NAME_PREFIXES.map((word) => (
                      <option key={word} value={word}>
                        {word}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  公开昵称称号
                  <select
                    value={noun}
                    onChange={(event) => setNoun(event.target.value as NameNoun)}
                  >
                    {NAME_NOUNS.map((word) => (
                      <option key={word} value={word}>
                        {word}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <output className="name-preview">
                公开显示：{prefix}
                {noun}#标签
              </output>
              <p className="recovery-warning">注册后暂不支持改名，也不提供邮箱或密码找回。</p>
            </>
          ) : null}
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-button wide" type="submit" disabled={busy}>
            {tab === 'register' ? '升级为注册账号' : '登录账号'}
          </button>
        </form>
      </section>
    </div>
  );
}
