import { useState, useEffect } from 'react';
import { Send, MessageSquare, TrendingUp, DollarSign, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type SidebarItem = 'sessions' | 'positions' | 'pnl' | 'settings';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// Matrix rain component
function MatrixRain() {
  useEffect(() => {
    const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
    const container = document.getElementById('matrix-container');
    if (!container) return;

    const columns = Math.floor(window.innerWidth / 20);
    
    for (let i = 0; i < columns; i++) {
      const char = document.createElement('div');
      char.className = 'matrix-char';
      char.textContent = chars[Math.floor(Math.random() * chars.length)];
      char.style.left = `${i * 20}px`;
      char.style.animationDuration = `${Math.random() * 3 + 2}s`;
      char.style.animationDelay = `${Math.random() * 2}s`;
      container.appendChild(char);
    }

    return () => {
      if (container) container.innerHTML = '';
    };
  }, []);

  return <div id="matrix-container" className="matrix-bg" />;
}

export default function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Welcome to APEYOLO. THE SAFEST WAY TO YOLO. How can I assist you today?',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [activeSection, setActiveSection] = useState<SidebarItem>('sessions');

  const handleSend = () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');

    // Simulate assistant response
    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Processing your request. Analyzing optimal strategies...',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, assistantMessage]);
    }, 500);
  };

  const sidebarItems = [
    { id: 'sessions' as SidebarItem, icon: MessageSquare, label: 'Sessions' },
    { id: 'positions' as SidebarItem, icon: TrendingUp, label: 'Positions' },
    { id: 'pnl' as SidebarItem, icon: DollarSign, label: 'P&L' },
    { id: 'settings' as SidebarItem, icon: Settings, label: 'Settings' }
  ];

  return (
    <div className="relative flex h-screen bg-black text-foreground overflow-hidden">
      {/* Content Layer */}
      <div className="relative z-10 flex w-full">
        {/* Left Sidebar */}
        <div className="w-64 border-r border-white/10 bg-charcoal flex flex-col">
          <div className="p-4 border-b border-white/10">
            <h1 className="text-xl font-bold tracking-wide">
              APEYOLO
            </h1>
            <p className="text-xs text-silver mt-1 tracking-wider">THE SAFEST WAY TO YOLO.</p>
          </div>
          
          <nav className="flex-1 p-2">
            {sidebarItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all mb-1',
                  activeSection === item.id
                    ? 'bg-white text-black'
                    : 'text-silver hover:bg-dark-gray hover:text-white border border-transparent'
                )}
                data-testid={`nav-${item.id}`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="p-4 border-t border-white/10">
            <div className="text-xs text-silver">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-white">ONLINE</span>
              </div>
              <div className="text-silver">SPY: Live data via IBKR</div>
            </div>
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col bg-black">
          {/* Messages */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-4xl mx-auto space-y-6">
              {messages.map(message => (
                <div
                  key={message.id}
                  className={cn(
                    'flex gap-3',
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[80%] rounded-lg p-4 transition-all',
                      message.role === 'user'
                        ? 'bg-white text-black'
                        : 'bg-dark-gray border border-white/10'
                    )}
                    data-testid={`message-${message.role}`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    <p className="text-xs opacity-60 mt-2 font-mono">
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Input Bar */}
          <div className="border-t border-white/10 bg-charcoal p-4">
            <div className="max-w-4xl mx-auto flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Enter command: execute trade, analyze position, check P&L..."
                className="flex-1 input-monochrome"
                data-testid="input-chat"
              />
              <Button 
                onClick={handleSend} 
                size="icon"
                className="btn-primary"
                data-testid="button-send"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
