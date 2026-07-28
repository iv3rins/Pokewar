import type { ChatMessage } from '@pokewar/protocol';
import { MessageSquare, Send, VolumeX, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { avatarAsset } from '../../services/avatar.js';

const MUTE_KEY = 'pokewar:chat-muted:v1';
function initialMuted(): string[] {
  try {
    return JSON.parse(localStorage.getItem(MUTE_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
export function ChatDrawer({
  messages,
  disabled,
  onSend,
}: {
  readonly messages: readonly ChatMessage[];
  readonly disabled: boolean;
  readonly onSend: (text: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [text, setText] = useState('');
  const [muted, setMuted] = useState<readonly string[]>(initialMuted);
  const visible = useMemo(
    () => messages.filter((message) => !muted.includes(message.senderId)),
    [messages, muted],
  );
  const latestVisibleId = visible.at(-1)?.id;
  const [seenId, setSeenId] = useState<string | undefined>(latestVisibleId);
  if (!open && latestVisibleId && latestVisibleId !== seenId) {
    setSeenId(latestVisibleId);
    setUnread((value) => value + 1);
  }
  const toggleMute = (senderId: string) => {
    const next = muted.includes(senderId)
      ? muted.filter((id) => id !== senderId)
      : [...muted, senderId];
    setMuted(next);
    localStorage.setItem(MUTE_KEY, JSON.stringify(next));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    if (await onSend(value)) setText('');
  };
  return (
    <>
      <button
        className="chat-toggle"
        type="button"
        aria-label="打开对局聊天"
        onClick={() => {
          setOpen(true);
          setUnread(0);
          setSeenId(latestVisibleId);
        }}
      >
        <MessageSquare size={20} />
        {unread > 0 ? <b>{unread}</b> : null}
      </button>
      {open ? (
        <aside className="chat-drawer" aria-label="对局聊天">
          <header>
            <h2>对局聊天</h2>
            <button type="button" aria-label="关闭聊天" onClick={() => setOpen(false)}>
              <X />
            </button>
          </header>
          <ol aria-live="polite">
            {visible.map((message) => (
              <li key={message.id}>
                <img src={avatarAsset(message.senderAvatarId)} alt="" />
                <div>
                  <strong>{message.senderName}</strong>
                  <p>{message.text}</p>
                </div>
                <button
                  type="button"
                  aria-label={`静音 ${message.senderName}`}
                  onClick={() => toggleMute(message.senderId)}
                >
                  <VolumeX size={16} />
                </button>
              </li>
            ))}
          </ol>
          <form onSubmit={(event) => void submit(event)}>
            <label htmlFor="chat-input">消息</label>
            <input
              id="chat-input"
              value={text}
              maxLength={200}
              disabled={disabled}
              onChange={(event) => setText(event.target.value)}
              autoComplete="off"
            />
            <button type="submit" disabled={disabled || !text.trim()} aria-label="发送消息">
              <Send size={18} />
            </button>
          </form>
        </aside>
      ) : null}
    </>
  );
}
