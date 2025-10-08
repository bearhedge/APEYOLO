import { useState } from 'react';
import { Send, MessageSquare, TrendingUp, DollarSign, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type SidebarItem = 'sessions' | 'positions' | 'pnl' | 'settings';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Welcome to Orca Options. I can help you execute trades, analyze positions, and manage your options portfolio. What would you like to do?',
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
        content: 'I understand your request. Let me help you with that.',
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
    <div className="flex h-screen bg-background text-foreground">
      {/* Left Sidebar */}
      <div className="w-64 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-xl font-bold bg-gradient-to-r from-teal-400 to-blue-400 bg-clip-text text-transparent">
            Orca Options
          </h1>
          <p className="text-xs text-muted-foreground mt-1">Agentic Trading Interface</p>
        </div>
        
        <nav className="flex-1 p-2">
          {sidebarItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors mb-1',
                activeSection === item.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
              data-testid={`nav-${item.id}`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="text-xs text-muted-foreground">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span>Market Open</span>
            </div>
            <div className="font-mono">SPY: $450.23</div>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Messages */}
        <ScrollArea className="flex-1 p-6">
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
                    'max-w-[80%] rounded-lg p-4',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card border border-border'
                  )}
                  data-testid={`message-${message.role}`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  <p className="text-xs opacity-60 mt-2">
                    {message.timestamp.toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Input Bar */}
        <div className="border-t border-border bg-card p-4">
          <div className="max-w-4xl mx-auto flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask me to execute a trade, analyze positions, or check P&L..."
              className="flex-1"
              data-testid="input-chat"
            />
            <Button onClick={handleSend} size="icon" data-testid="button-send">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
