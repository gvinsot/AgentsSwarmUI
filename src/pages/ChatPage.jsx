import { useEffect, useRef, useState } from 'react';
import ChatInput from '../components/ChatInput';
import VoiceConnectionIndicator from '../components/VoiceConnectionIndicator';
import styles from './ChatPage.module.css';

const ChatPage = () => {
  const [messages, setMessages] = useState([
    { id: 1, role: 'agent', content: 'Hello! I am your agent. How can I help you today?' },
  ]);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

  useEffect(() => {
    if (!autoScrollEnabled) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, autoScrollEnabled]);

  const handleSend = (text) => {
    if (!text?.trim()) return;
    setMessages((prev) => [...prev, { id: Date.now(), role: 'user', content: text }]);
  };

  const toggleAutoScroll = () => {
    setAutoScrollEnabled((prev) => {
      const next = !prev;
      if (next) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
      return next;
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.chatArea}>
        <div className={styles.messages} ref={messagesContainerRef}>
          {messages.map((m) => (
            <div
              key={m.id}
              className={`${styles.message} ${m.role === 'user' ? styles.user : styles.agent}`}
            >
              {m.content}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className={styles.bottomBar}>
          <button
            type="button"
            className={`${styles.autoScrollToggle} ${autoScrollEnabled ? styles.on : styles.off}`}
            onClick={toggleAutoScroll}
            aria-pressed={autoScrollEnabled}
            aria-label={`Auto-scroll is ${autoScrollEnabled ? 'on' : 'off'}. Click to turn ${autoScrollEnabled ? 'off' : 'on'}.`}
          >
            Auto-scroll: {autoScrollEnabled ? 'On' : 'Off'}
          </button>

          <ChatInput onSend={handleSend} />
        </div>
      </div>

      <VoiceConnectionIndicator />
    </div>
  );
};

export default ChatPage;